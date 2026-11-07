"""Agent server entry point.

Loads config, wires the agent's handlers into the (SDK-agnostic) FastAPI app from ``server/app.py``,
and runs uvicorn. The handlers live in ``agent/agent.py`` — the only SDK-specific piece.
"""

import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

# Importing the agent is side-effect-free (no env is read until configure()), so it sits up top.
import agent.agent
from server.app import build_app

# Load .env before configure() reads env (agent client auth + tracing config), then wire the agent.
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=True)
agent.agent.configure()

# Module-level app so uvicorn can import it by string (and to enable multiple workers).
app = build_app(agent.agent.invoke_handler, agent.agent.stream_handler)


def main():
    uvicorn.run("server.start_server:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
