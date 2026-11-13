"""Workspace config and identities for running evals."""

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import mlflow
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

REPO = Path(__file__).resolve().parents[1]

EVAL_WORKERS = "2"


def cli_json(*arguments: str) -> dict[str, Any]:
    """Run a Databricks CLI command as the CLI identity and parse its JSON."""
    result = subprocess.run(
        ["databricks", *arguments, "-o", "json"],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def git_sha() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def token_for(who: str) -> str:
    """Mint a one-hour M2M token for a test identity with the repo's script."""
    return subprocess.run(
        [str(REPO / "scripts" / "test_user_token.sh"), who],
        cwd=REPO,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


class Workspace:
    """What the CLI identity reads once: the bundle, the app, the tokens."""

    def __init__(self) -> None:
        bundle = cli_json("bundle", "validate")
        self.variables = {
            name: value.get("value") for name, value in bundle["variables"].items()
        }
        self.catalog = self.variables["catalog"]
        self.project = self.variables["project"]
        self.warehouse_id = self.variables["warehouse_id"]
        self.eval_schema = f"{self.catalog}.{self.project}_eval"
        self.host = cli_json("auth", "describe")["details"]["host"]
        resources = bundle["resources"]["experiments"]
        self.experiment = resources["evals"]["name"]
        self.trace_experiment = resources["agent_traces"]["name"]
        app = cli_json("apps", "get", self.variables["agent_app_name"])
        self.app_url = app["url"]
        self.deployment = app.get("active_deployment", {}).get("deployment_id", "")
        service = resources_model_service(bundle)
        self.model_service = cli_json("ai-gateway", "get-model-service", service)

    def table(self, name: str) -> str:
        """Table or prompt in eval schema."""
        return f"{self.eval_schema}.{name}"


def resources_model_service(bundle: dict[str, Any]) -> str:
    ops = bundle["resources"]["schemas"]["ops"]
    service = bundle["resources"]["model_services"]["sonnet_llm"]["model_service_id"]
    return f"model-services/{ops['catalog_name']}.{ops['name']}.{service}"


def query(
    client: WorkspaceClient, workspace: Workspace, sql: str
) -> list[dict[str, str]]:
    """Run query in data schema, returning rows by column name."""
    response = client.statement_execution.execute_statement(
        statement=sql,
        warehouse_id=workspace.warehouse_id,
        catalog=workspace.catalog,
        schema=f"{workspace.project}_data",
        wait_timeout="50s",
    )
    if response.status.state != StatementState.SUCCEEDED:
        error = response.status.error.message if response.status.error else ""
        raise RuntimeError(
            f"An expected-value query {response.status.state.value}: {error}\n{sql}\n"
            "Run reset_data, then the evals again."
        )
    columns = [column.name for column in response.manifest.schema.columns]
    rows = (response.result.data_array if response.result else None) or []
    return [dict(zip(columns, row, strict=True)) for row in rows]


def use_runner_identity(workspace: Workspace, token: str) -> None:
    """Make every later MLflow and SDK call in this process run as the runner."""
    os.environ.pop("DATABRICKS_CONFIG_PROFILE", None)
    os.environ.update(
        DATABRICKS_HOST=workspace.host,
        DATABRICKS_TOKEN=token,
        DATABRICKS_AUTH_TYPE="pat",
        MLFLOW_GENAI_EVAL_MAX_WORKERS=EVAL_WORKERS,
    )
    mlflow.set_tracking_uri("databricks")
    mlflow.set_registry_uri("databricks-uc")
