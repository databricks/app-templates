"""Agent server entry point. load_dotenv must run before agent imports (auth config)."""
# ruff: noqa: E402
from dotenv import load_dotenv

# Load env vars from .env before any other imports (agent needs auth config)
load_dotenv(dotenv_path=".env", override=True)

import logging
import os

from mlflow.genai.agent_server import setup_mlflow_git_based_version_tracking

# Need to import the agent to register the functions with the server
import agent_server.agent # noqa: E402
from agent_server.db import dispose_db, init_db, is_db_configured
from agent_server.long_running_server import LongRunningAgentServer


_log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

agent_server = LongRunningAgentServer("ResponsesAgent", enable_chat_proxy=True)


@agent_server.app.on_event("startup")
async def startup_db():
    if is_db_configured():
        await init_db()


@agent_server.app.on_event("shutdown")
async def shutdown_db():
    if is_db_configured():
        await dispose_db()


# Define the app as a module level variable to enable multiple workers
app = agent_server.app  # noqa: F841
setup_mlflow_git_based_version_tracking()


def main():
    agent_server.run(app_import_string="agent_server.start_server:app")
