"""Agent server entry point. load_dotenv must run before agent imports."""
# ruff: noqa: E402

import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Load env vars from .env before any other imports (agent needs auth config)
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

import logging

from databricks_ai_bridge.long_running import LongRunningAgentServer
from mlflow.genai.agent_server import setup_mlflow_git_based_version_tracking

# Need to import the agent to register the functions with the server
import agent_server.agent  # noqa: E402, F401
from agent_server.settings import settings

logger = logging.getLogger(__name__)

logging.getLogger("agent_server").setLevel(
    getattr(logging, settings.log_level.upper(), logging.INFO)
)


@dataclass(frozen=True)
class LakebaseConfig:
    """Lakebase configuration for long-running response persistence."""

    instance_name: str | None
    autoscaling_endpoint: str | None
    autoscaling_project: str | None
    autoscaling_branch: str | None

    @property
    def configured(self) -> bool:
        return bool(
            self.instance_name
            or self.autoscaling_endpoint
            or (self.autoscaling_project and self.autoscaling_branch)
        )

    @property
    def description(self) -> str:
        if self.autoscaling_endpoint:
            return self.autoscaling_endpoint
        if self.instance_name:
            return self.instance_name
        if self.autoscaling_project and self.autoscaling_branch:
            return f"{self.autoscaling_project}/{self.autoscaling_branch}"
        return "not configured"


def _init_lakebase_config() -> LakebaseConfig:
    """Read Lakebase env vars in the priority expected by databricks-ai-bridge."""
    endpoint = os.getenv("LAKEBASE_AUTOSCALING_ENDPOINT") or None
    raw_name = os.getenv("LAKEBASE_INSTANCE_NAME") or None
    project = os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or None
    branch = os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or None

    if endpoint:
        return LakebaseConfig(
            instance_name=None,
            autoscaling_endpoint=endpoint,
            autoscaling_project=None,
            autoscaling_branch=None,
        )
    if project and branch:
        return LakebaseConfig(
            instance_name=None,
            autoscaling_endpoint=None,
            autoscaling_project=project,
            autoscaling_branch=branch,
        )
    if raw_name:
        return LakebaseConfig(
            instance_name=_resolve_lakebase_instance_name(raw_name),
            autoscaling_endpoint=None,
            autoscaling_project=None,
            autoscaling_branch=None,
        )

    return LakebaseConfig(
        instance_name=None,
        autoscaling_endpoint=None,
        autoscaling_project=None,
        autoscaling_branch=None,
    )


def _is_lakebase_hostname(value: str) -> bool:
    return ".database." in value and value.endswith(".com")


def _resolve_lakebase_instance_name(instance_name: str) -> str:
    """Resolve value_from database hostnames to Lakebase instance names."""
    if not _is_lakebase_hostname(instance_name):
        return instance_name

    from databricks.sdk import WorkspaceClient

    client = WorkspaceClient()
    hostname = instance_name

    try:
        instances = list(client.database.list_database_instances())
    except Exception as exc:
        raise ValueError(
            f"Unable to list database instances to resolve hostname '{hostname}'. "
            "Ensure you have access to database instances."
        ) from exc

    for instance in instances:
        rw_dns = getattr(instance, "read_write_dns", None)
        ro_dns = getattr(instance, "read_only_dns", None)
        if hostname in (rw_dns, ro_dns):
            resolved_name = getattr(instance, "name", None)
            if not resolved_name:
                raise ValueError(
                    f"Found matching instance for hostname '{hostname}' "
                    "but instance name is not available."
                )
            logger.info(
                "Resolved Lakebase hostname '%s' to instance name '%s'",
                hostname,
                resolved_name,
            )
            return resolved_name

    raise ValueError(
        f"Unable to find database instance matching hostname '{hostname}'. "
        "Ensure the hostname is correct and the instance exists."
    )


def _is_lakebase_access_error(exc: Exception) -> bool:
    error_msg = str(exc).lower()
    return any(
        keyword in error_msg
        for keyword in [
            "lakebase",
            "pg_hba",
            "postgres",
            "database instance",
            "insufficient privilege",
        ]
    )


def _get_lakebase_access_error_message(lakebase_description: str) -> str:
    """Generate a targeted message for Lakebase access and permission failures."""
    if os.getenv("DATABRICKS_APP_NAME"):
        app_name = os.getenv("DATABRICKS_APP_NAME")
        return (
            f"Failed to connect to Lakebase instance '{lakebase_description}'. "
            f"The App Service Principal for '{app_name}' may not have access.\n\n"
            "To fix this:\n"
            "1. In the Databricks UI, open your app.\n"
            "2. Click Edit > App resources > Add resource.\n"
            "3. Add your Lakebase instance as a resource.\n"
            "4. Grant the app service principal the required Postgres permissions."
        )

    return (
        f"Failed to connect to Lakebase instance '{lakebase_description}'. "
        "Verify the instance name, your Databricks authentication, and your "
        "Lakebase permissions."
    )


_FAKE_RESPONSE_ID_VALUES = {"__fake_id__"}
_FAKE_RESPONSE_ID_PREFIXES = ("resp_placeholder_",)


def _replace_response_id_placeholders(obj: Any, response_id: str) -> Any:
    """Replace SDK placeholder response IDs with the durable background ID."""
    if isinstance(obj, dict):
        return {
            key: _replace_response_id_placeholders(value, response_id)
            for key, value in obj.items()
        }
    if isinstance(obj, list):
        return [_replace_response_id_placeholders(item, response_id) for item in obj]
    if isinstance(obj, str):
        if obj in _FAKE_RESPONSE_ID_VALUES or obj.startswith(_FAKE_RESPONSE_ID_PREFIXES):
            return response_id
    return obj


class AgentServer(LongRunningAgentServer):
    """Long-running server with Claude SDK stream-event normalization."""

    def transform_stream_event(self, event: Any, response_id: str) -> Any:
        return _replace_response_id_placeholders(event, response_id)


lakebase_config = _init_lakebase_config()

agent_server = AgentServer(
    "ResponsesAgent",
    enable_chat_proxy=True,
    db_instance_name=lakebase_config.instance_name,
    db_autoscaling_endpoint=lakebase_config.autoscaling_endpoint,
    db_project=lakebase_config.autoscaling_project,
    db_branch=lakebase_config.autoscaling_branch,
    task_timeout_seconds=settings.task_timeout_seconds,
    poll_interval_seconds=settings.poll_interval_seconds,
)


# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()

_original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def _lifespan(app):
    try:
        async with _original_lifespan(app):
            yield
    except Exception as exc:
        if lakebase_config.configured and _is_lakebase_access_error(exc):
            logger.error(
                "Long-running Lakebase initialization failed: %s\n\n%s",
                exc,
                _get_lakebase_access_error_message(lakebase_config.description),
            )
        else:
            logger.warning(
                "Long-running DB initialization failed: %s. Background mode disabled.",
                exc,
            )
        yield


app.router.lifespan_context = _lifespan


def main():
    agent_server.run(app_import_string="agent_server.start_server:app")
