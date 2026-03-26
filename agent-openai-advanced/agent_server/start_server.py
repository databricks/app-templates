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
from databricks_openai.agents import AsyncDatabricksSession
from mlflow.genai.agent_server import setup_mlflow_git_based_version_tracking

# Need to import the agent to register the functions with the server
import agent_server.agent  # noqa: F401
from agent_server.agent import LAKEBASE_AUTOSCALING_BRANCH, LAKEBASE_AUTOSCALING_PROJECT, LAKEBASE_INSTANCE_NAME
from agent_server.utils import replace_fake_id

logger = logging.getLogger(__name__)


async def run_lakebase_session_setup() -> None:
    """Create session tables at startup so per-request _ensure_tables is a no-op."""
    session = AsyncDatabricksSession(
        session_id="__startup__",
        instance_name=LAKEBASE_INSTANCE_NAME,
        project=LAKEBASE_AUTOSCALING_PROJECT,
        branch=LAKEBASE_AUTOSCALING_BRANCH,
    )
    await session._ensure_tables()
    logger.info("Lakebase session tables verified")


class AgentServer(LongRunningAgentServer):
    def transform_stream_event(self, event, response_id):
        return replace_fake_id(event, response_id)


agent_server = AgentServer(
    "ResponsesAgent",
    enable_chat_proxy=True,
    db_instance_name=os.getenv("LAKEBASE_INSTANCE_NAME"),
    db_project=os.getenv("LAKEBASE_AUTOSCALING_PROJECT"),
    db_branch=os.getenv("LAKEBASE_AUTOSCALING_BRANCH"),
    task_timeout_seconds=float(os.getenv("TASK_TIMEOUT_SECONDS", "3600")),
    poll_interval_seconds=float(os.getenv("POLL_INTERVAL_SECONDS", "1.0")),
)

log_level = os.getenv("LOG_LEVEL", "INFO")
logging.getLogger("agent_server").setLevel(getattr(logging, log_level.upper(), logging.INFO))

# Wrap the existing lifespan to ensure session tables are created before serving requests
_original_lifespan = agent_server.app.router.lifespan_context


@asynccontextmanager
async def _lifespan(app):
    await run_lakebase_session_setup()
    async with _original_lifespan(app):
        yield


agent_server.app.router.lifespan_context = _lifespan

# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()


def main():
    agent_server.run(app_import_string="agent_server.start_server:app")
