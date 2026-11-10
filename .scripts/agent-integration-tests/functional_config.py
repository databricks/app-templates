"""Registry for functional e2e tests (Increment 1: 4 exemplars)."""
from __future__ import annotations
from dataclasses import dataclass

VALID_FAMILIES = {"streamlit", "dash", "flask", "gradio", "shiny", "node", "mcp", "agent"}


@dataclass(frozen=True)
class FunctionalTemplate:
    name: str
    family: str
    launch: dict          # family-specific launch hints (command/port/ready path)
    test: dict            # {"kind": "...", ...}
    required_resources: tuple[str, ...]
    # True when the happy path calls a model serving endpoint. On SSO-walled
    # workspaces (e.g. dogfood staging) the OpenAI-compat serving path redirects
    # local clients to a login page, so these rows are skipped (not failed) for
    # --target local there; they pass on a normal workspace and run deployed.
    model_dependent: bool = False


def missing_resources(ft: "FunctionalTemplate", env: dict) -> list[str]:
    return [r for r in ft.required_resources if not env.get(r)]


FUNCTIONAL_TEMPLATES: dict[str, FunctionalTemplate] = {
    "streamlit-database-app": FunctionalTemplate(
        name="streamlit-database-app", family="streamlit",
        launch={"ready_path": "/"},
        test={"kind": "py-playwright", "spec": "tests/e2e/test_app.py"},
        required_resources=(),
    ),
    "e2e-chatbot-app-next": FunctionalTemplate(
        name="e2e-chatbot-app-next", family="node",
        launch={"dev_script": "dev", "ready_path": "/"},
        test={"kind": "node-playwright", "project": "e2e",
              "grep": "Send a user message and receive response"},
        required_resources=("DATABRICKS_SERVING_ENDPOINT",),
        model_dependent=True,
    ),
    "mcp-server-hello-world": FunctionalTemplate(
        name="mcp-server-hello-world", family="mcp",
        launch={"ready_path": "/"},
        test={"kind": "mcp"},
        required_resources=(),
    ),
    "agent-langgraph": FunctionalTemplate(
        name="agent-langgraph", family="agent",
        launch={"ready_path": "/agent/info"},
        test={"kind": "agent-api"},
        required_resources=(),
        model_dependent=True,
    ),
}
