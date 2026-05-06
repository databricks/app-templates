"""Agent server entry point. load_dotenv must run before agent imports (auth config)."""

# ruff: noqa: E402
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load env vars from .env before any other imports (agent needs auth config)
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

import logging

from databricks_ai_bridge.long_running import LongRunningAgentServer
from mlflow.genai.agent_server import setup_mlflow_git_based_version_tracking

logger = logging.getLogger(__name__)

# Need to import the agent to register the functions with the server
import agent_server.agent  # noqa: F401

from agent_server.agent import LAKEBASE_CONFIG
from agent_server.utils import replace_fake_id
from agent_server.utils_memory import get_lakebase_access_error_message, run_lakebase_setup


class AgentServer(LongRunningAgentServer):
    def transform_stream_event(self, event, response_id):
        return replace_fake_id(event, response_id)


agent_server = AgentServer(
    "ResponsesAgent",
    enable_chat_proxy=True,
    db_instance_name=LAKEBASE_CONFIG.instance_name,
    db_autoscaling_endpoint=LAKEBASE_CONFIG.autoscaling_endpoint,
    db_project=LAKEBASE_CONFIG.autoscaling_project,
    db_branch=LAKEBASE_CONFIG.autoscaling_branch,
    task_timeout_seconds=float(os.getenv("TASK_TIMEOUT_SECONDS", "3600")),
    poll_interval_seconds=float(os.getenv("POLL_INTERVAL_SECONDS", "1.0")),
)

# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()

_original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def _lifespan(app):
    try:
        await run_lakebase_setup(LAKEBASE_CONFIG)
    except Exception as exc:
        error_msg = str(exc).lower()
        if any(
            keyword in error_msg
            for keyword in ["lakebase", "pg_hba", "postgres", "database instance", "insufficient privilege"]
        ):
            logger.error(
                "Lakebase session setup failed: %s\n\n%s",
                exc,
                get_lakebase_access_error_message(LAKEBASE_CONFIG.description),
            )
        else:
            logger.error("Lakebase session setup failed: %s", exc, exc_info=True)
        raise
    try:
        async with _original_lifespan(app):
            yield
    except Exception as exc:
        logger.warning("Long-running DB initialization failed: %s. Background mode disabled.", exc)
        yield


app.router.lifespan_context = _lifespan


def main():
    agent_server.run(app_import_string="agent_server.start_server:app")
