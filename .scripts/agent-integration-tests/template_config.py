import re
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Configurable defaults — override via pytest CLI options
# Workspace: https://db-ml-models-dev-us-west.cloud.databricks.com
# ---------------------------------------------------------------------------
DEFAULT_PROFILE = "dev"
DEFAULT_LAKEBASE = "bbqiu"
DEFAULT_LAKEBASE_AUTOSCALING_ENDPOINT = "projects/bryan-agent-integ-tests/branches/production/endpoints/primary"
DEFAULT_GENIE_SPACE_ID = "01f05202dbb51d74b6cccf1b1b1683eb"
DEFAULT_SERVING_ENDPOINT = "agents_dev-bbqiu-test-bb-2-25"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class FileEdit:
    """A file edit to apply/revert."""

    relative_path: str  # e.g. "databricks.yml" or "agent_server/agent.py"
    old: str  # text to find
    new: str  # text to replace with


@dataclass
class TemplateConfig:
    name: str  # e.g. "agent-langgraph"
    dev_app_name: str  # e.g. "dev-agent-langgraph"
    app_resource_key: str  # DAB resource key under resources.apps
    is_conversational: bool = True  # /responses vs /invocations
    needs_lakebase: bool = False  # Whether template uses lakebase
    lakebase_type: str = ""  # "provisioned", "autoscaling", or ""
    is_advanced: bool = False  # Whether this is an advanced template (has session + long-term memory)
    pre_test_edits: list[FileEdit] = field(default_factory=list)
    has_evaluate: bool = True
    validate_time: bool = True  # Whether to validate get_current_time tool output


# ---------------------------------------------------------------------------
# Multiagent SUBAGENTS
# ---------------------------------------------------------------------------


def _multiagent_subagents_new(
    genie_space_id: str, serving_endpoint: str
) -> str:
    return f"""\
SUBAGENTS = [
    {{
        "name": "genie",
        "type": "genie",
        "space_id": "{genie_space_id}",
        "description": (
            "Query a Genie space for structured data analysis. "
            "Use this for questions about data, metrics, and tables."
        ),
    }},
    {{
        "name": "serving_endpoint",
        "type": "serving_endpoint",
        "endpoint": "{serving_endpoint}",
        "description": (
            "Query a model hosted on a Databricks Model Serving endpoint. "
            "Use this for questions best answered by the serving model. "
            "The endpoint must have task type agent/v1/responses."
        ),
    }},
]"""


def _multiagent_edits(
    template_name: str,
    genie_space_id: str,
    serving_endpoint: str,
) -> list[FileEdit]:
    """Build pre_test_edits for multiagent, skipping already-configured values."""
    template_dir = REPO_ROOT / template_name
    edits: list[FileEdit] = []

    # Match the SUBAGENTS = [...] block and replace if it still has commented-out code
    agent_py = (template_dir / "agent_server" / "agent.py").read_text()
    match = re.search(r"SUBAGENTS\s*=\s*\[.*?\]", agent_py, re.DOTALL)
    if match and "#" in match.group(0):
        edits.append(
            FileEdit(
                relative_path="agent_server/agent.py",
                old=match.group(0),
                new=_multiagent_subagents_new(genie_space_id, serving_endpoint),
            )
        )

    # Only replace databricks.yml placeholders if they exist
    yml_text = (template_dir / "databricks.yml").read_text()
    for old, new in [
        ("<YOUR-GENIE-SPACE-ID>", genie_space_id),
        ("<YOUR-SERVING-ENDPOINT>", serving_endpoint),
        ("<YOUR-KNOWLEDGE-ASSISTANT-ENDPOINT>", serving_endpoint),
    ]:
        if old in yml_text:
            edits.append(FileEdit(relative_path="databricks.yml", old=old, new=new))

    return edits


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[2]


def _parse_databricks_yml(template_name: str) -> tuple[str, str]:
    """Parse dev_app_name and app_resource_key from databricks.yml.

    Returns (dev_app_name, app_resource_key) where dev_app_name
    has ${bundle.target} resolved to 'dev'.
    """
    yml_path = REPO_ROOT / template_name / "databricks.yml"
    text = yml_path.read_text()

    app_match = re.search(
        r'^\s*apps:\s*\n\s*(\w+):\s*\n\s*name:\s*"([^"]+)"', text, re.MULTILINE
    )
    assert app_match, f"Could not find app name in {yml_path}"
    app_resource_key = app_match.group(1)
    dev_app_name = app_match.group(2).replace("${bundle.target}", "dev")

    assert len(dev_app_name) <= 30, (
        f"App name '{dev_app_name}' is {len(dev_app_name)} chars (max 30) "
        f"in {yml_path}"
    )
    return dev_app_name, app_resource_key


# ---------------------------------------------------------------------------
# Template builder
# ---------------------------------------------------------------------------
def build_templates(
    genie_space_id: str = DEFAULT_GENIE_SPACE_ID,
    serving_endpoint: str = DEFAULT_SERVING_ENDPOINT,
) -> list[TemplateConfig]:
    # (name, needs_lakebase, overrides)
    configs: list[tuple[str, bool, dict]] = [
        ("agent-langgraph", False, {}),
        ("agent-langgraph-advanced", True, {"is_advanced": True}),
        ("agent-openai-agents-sdk", False, {}),
        ("agent-openai-advanced", True, {"is_advanced": True}),
        (
            "agent-openai-agents-sdk-multiagent",
            False,
            {
                "pre_test_edits": _multiagent_edits(
                    "agent-openai-agents-sdk-multiagent",
                    genie_space_id,
                    serving_endpoint,
                ),
                "validate_time": False,
            },
        ),
        ("agent-non-conversational", False, {"is_conversational": False, "has_evaluate": False}),
    ]

    templates = []
    for name, needs_lakebase, overrides in configs:
        dev_app_name, app_resource_key = _parse_databricks_yml(name)
        if needs_lakebase:
            for lb_type in ("provisioned", "autoscaling"):
                templates.append(
                    TemplateConfig(
                        name=name,
                        dev_app_name=dev_app_name,
                        app_resource_key=app_resource_key,
                        needs_lakebase=True,
                        lakebase_type=lb_type,
                        **overrides,
                    )
                )
        else:
            templates.append(
                TemplateConfig(
                    name=name,
                    dev_app_name=dev_app_name,
                    app_resource_key=app_resource_key,
                    **overrides,
                )
            )
    return templates
