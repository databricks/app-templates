"""Scheduled scorers on a sample of the production traces."""

import argparse

import mlflow
from mlflow.genai.scorers import PIIDetection, RegexMatch, Safety
from mlflow.genai.scorers.base import ScorerSamplingConfig
from mlflow.tracing import set_databricks_monitoring_sql_warehouse_id

from evals.guidelines import ID_PATTERN
from evals.scorers import PII_TYPES
from evals.workspace import Workspace, token_for, use_runner_identity

PRODUCTION_SAMPLE_RATE = 0.1


def schedule(arguments: argparse.Namespace) -> int:
    """Score production trace sample for safety and information leaks.

    The traces live in Unity Catalog, so the monitoring job reads its SQL warehouse
    from an experiment tag, which must be set before the first scorer registers.
    """
    workspace = Workspace()
    use_runner_identity(workspace, token_for("eval"))
    experiment = mlflow.set_experiment(workspace.trace_experiment)
    set_databricks_monitoring_sql_warehouse_id(
        workspace.warehouse_id, experiment.experiment_id
    )
    sampling = ScorerSamplingConfig(sample_rate=arguments.sample_rate)
    production = [
        Safety(),
        PIIDetection(pii_types=PII_TYPES),
        RegexMatch(name="reply_shows_an_id", pattern=ID_PATTERN),
    ]
    for production_scorer in production:
        registered = production_scorer.register(
            name=production_scorer.name, experiment_id=experiment.experiment_id
        )
        registered.start(
            experiment_id=experiment.experiment_id, sampling_config=sampling
        )
        print(f"{production_scorer.name}: scoring {arguments.sample_rate:.0%}")
    return 0
