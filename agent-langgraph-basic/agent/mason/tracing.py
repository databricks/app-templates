"""MLflow tracing setup — opt-in, enabled when MLflow has both a destination and an experiment.

Tracing turns on only when a full config is present: a destination (``MLFLOW_TRACKING_URI`` or
``MLFLOW_TRACING_DESTINATION``) AND an experiment (``MLFLOW_EXPERIMENT_ID`` or
``MLFLOW_EXPERIMENT_NAME``) — whichever pair the user or the Apps resource binding provides. MLflow
resolves the specific value itself; this only decides on/off. Requiring both halves avoids the
half-configured case where traces silently export to a local file store instead of the workspace.
When unconfigured, tracing is disabled outright so the agent-server framework's mandatory per-request
span has nothing to export to. No user decision lives here — it's all driven by env — so this whole
module is a candidate to move behind an SDK helper.
"""

import os

import mlflow

# Destination and experiment can each be named more than one way; accept any combination MLflow
# understands (see mlflow.tracking.fluent._get_experiment_id_from_env for the experiment resolution).
_DESTINATION_VARS = ("MLFLOW_TRACKING_URI", "MLFLOW_TRACING_DESTINATION")
_EXPERIMENT_VARS = ("MLFLOW_EXPERIMENT_ID", "MLFLOW_EXPERIMENT_NAME")

# Snapshotted once by configure() at startup (after .env is loaded) rather than at import, so this
# module has no import-time side effects and load order does not matter.
_enabled = False


def configure() -> None:
    """Wire up tracing. Call once at startup."""
    global _enabled
    has_destination = any(os.getenv(v) for v in _DESTINATION_VARS)
    has_experiment = any(os.getenv(v) for v in _EXPERIMENT_VARS)
    _enabled = has_destination and has_experiment
    if _enabled:
        mlflow.langchain.autolog()
    else:
        # The agent-server framework wraps every request in a span regardless; without an
        # experiment it would try to export to a missing one (INVALID_PARAMETER_VALUE), so disable.
        mlflow.tracing.disable()


def tag_session(session_id: str) -> None:
    """Tag the active MLflow trace with the session id, when tracing is enabled."""
    if _enabled and session_id:
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})
