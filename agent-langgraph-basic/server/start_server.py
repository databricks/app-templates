"""Agent server entry point."""

import os
from pathlib import Path

from databricks_ai_bridge.long_running import LongRunningAgentServer
from dotenv import load_dotenv

# Importing the agent registers its @invoke/@stream handlers; the import is side-effect-free (no env
# is read until configure()), so it can sit with the other imports.
import agent.agent

# Load .env before the runtime steps below read env (agent client auth + tracing config).
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)

agent.agent.configure()

# Pass the Lakebase autoscaling endpoint through from the env (set by the "postgres" app resource).
# When it's set, LongRunningAgentServer enables durable background mode + crash recovery; when unset
# (local dev, no Lakebase) it's None, so the server serves in-request.
agent_server = LongRunningAgentServer(
    "ResponsesAgent",
    db_autoscaling_endpoint=os.getenv("LAKEBASE_AUTOSCALING_ENDPOINT"),
)

# Module-level app so uvicorn can import it by string (and to enable multiple workers).
app = agent_server.app


def main():
    agent_server.run(app_import_string="server.start_server:app")
