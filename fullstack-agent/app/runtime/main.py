"""Serve the agent, its API routes and the built frontend."""

import os
from pathlib import Path

import uvicorn
from databricks_agentkit import DurableAgentServer
from dotenv import load_dotenv

from agent.agent import configure
from runtime.adapter import invocation_handler, recover
from runtime.frontend import frontend
from runtime.middleware import SecurityHeadersMiddleware
from runtime.routers import install_api
from runtime.telemetry import configure_telemetry

PROJECT_DIR = Path(__file__).parent.parent
FRONTEND_DIR = PROJECT_DIR / "static"

load_dotenv(dotenv_path=PROJECT_DIR / ".env", override=False)
configure_telemetry()
configure()

app = DurableAgentServer()
app.add_middleware(SecurityHeadersMiddleware)
app.invoke(invocation_handler(app))
app.recover(recover)
install_api(app)
app.mount("/", frontend(FRONTEND_DIR), name="frontend")


def main() -> None:
    """Serve a local run on loopback only: it trusts any X-Forwarded-Email."""
    uvicorn.run(
        "runtime.main:app", host="127.0.0.1", port=int(os.getenv("PORT", "8000"))
    )
