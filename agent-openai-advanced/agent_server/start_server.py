"""Agent server entry point. load_dotenv must run before agent imports (auth config)."""

# ruff: noqa: E402
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load env vars from .env before any other imports (agent needs auth config)
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

import logging
import sys

from databricks_ai_bridge.long_running import LongRunningAgentServer
from databricks_openai.agents import AsyncDatabricksSession
from mlflow.genai.agent_server import setup_mlflow_git_based_version_tracking

from agent_server.utils import get_lakebase_access_error_message, lakebase_config, replace_fake_id

# Need to import the agent to register the functions with the server
import agent_server.agent  # noqa: F401

logger = logging.getLogger(__name__)

# Surface databricks_ai_bridge INFO logs (durable-execution lifecycle:
# task spawn, resume, prose-recovery, terminal status, stale-scan claims)
# in app stdout. Uvicorn's default logging config drops INFO from
# non-uvicorn loggers, so attach a stream handler explicitly.
_bridge_logger = logging.getLogger("databricks_ai_bridge")
if _bridge_logger.level == logging.NOTSET or _bridge_logger.level > logging.INFO:
    _bridge_logger.setLevel(logging.INFO)
if not any(isinstance(h, logging.StreamHandler) for h in _bridge_logger.handlers):
    _bridge_handler = logging.StreamHandler(sys.stdout)
    _bridge_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    _bridge_logger.addHandler(_bridge_handler)
    _bridge_logger.propagate = False


async def run_lakebase_session_setup() -> None:
    """Create session tables at startup so per-request _ensure_tables is a no-op."""
    session = AsyncDatabricksSession(
        session_id="__startup__",
        instance_name=lakebase_config.instance_name,
        autoscaling_endpoint=lakebase_config.autoscaling_endpoint,
        project=lakebase_config.autoscaling_project,
        branch=lakebase_config.autoscaling_branch,
        schema=lakebase_config.memory_schema,
    )

    # _ensure_tables is private API — needed to create tables at startup rather than per-request.
    # If this breaks on a databricks-openai upgrade, replace with the public equivalent.
    await session._ensure_tables()


class AgentServer(LongRunningAgentServer):
    def transform_stream_event(self, event, response_id):
        return replace_fake_id(event, response_id)


agent_server = AgentServer(
    "ResponsesAgent",
    enable_chat_proxy=True,
    db_instance_name=lakebase_config.instance_name,
    db_autoscaling_endpoint=lakebase_config.autoscaling_endpoint,
    db_project=lakebase_config.autoscaling_project,
    db_branch=lakebase_config.autoscaling_branch,
    task_timeout_seconds=float(os.getenv("TASK_TIMEOUT_SECONDS", "3600")),
    poll_interval_seconds=float(os.getenv("POLL_INTERVAL_SECONDS", "1.0")),
)

log_level = os.getenv("LOG_LEVEL", "INFO")
logging.getLogger("agent_server").setLevel(getattr(logging, log_level.upper(), logging.INFO))

# Wrap the existing lifespan to ensure session tables are created before serving requests
_original_lifespan = agent_server.app.router.lifespan_context


@asynccontextmanager
async def _lifespan(app):
    try:
        await run_lakebase_session_setup()
    except Exception as exc:
        error_msg = str(exc).lower()
        if any(
            keyword in error_msg
            for keyword in ["lakebase", "pg_hba", "postgres", "database instance", "insufficient privilege"]
        ):
            logger.error(
                "Lakebase session setup failed: %s\n\n%s",
                exc,
                get_lakebase_access_error_message(lakebase_config.description),
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


agent_server.app.router.lifespan_context = _lifespan

# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()


def main():
    agent_server.run(app_import_string="agent_server.start_server:app")
