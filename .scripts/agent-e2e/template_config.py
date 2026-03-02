import re
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Configurable defaults — override via pytest CLI options
# ---------------------------------------------------------------------------
DEFAULT_PROFILE = "dev"
DEFAULT_LAKEBASE = "bbqiu"
DEFAULT_GENIE_SPACE_ID = "01f05202dbb51d74b6cccf1b1b1683eb"
DEFAULT_SERVING_ENDPOINT = "agents_dev-bbqiu-test-bb-2-25"
DEFAULT_KNOWLEDGE_ASSISTANT_ENDPOINT = "agents_dev-bbqiu-test-bb-2-25"


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
    bundle_name: str  # e.g. "agent_langgraph"
    dev_app_name: str  # e.g. "dev-agent-langgraph"
    is_conversational: bool = True  # /responses vs /invocations
    needs_lakebase_edit: bool = False  # Whether databricks.yml has lakebase placeholder
    pre_test_edits: list[FileEdit] = field(default_factory=list)
    has_evaluate: bool = True


# ---------------------------------------------------------------------------
# Multiagent SUBAGENTS — the "old" block is the verbatim commented-out code
# in agent-openai-agents-sdk-multiagent/agent_server/agent.py (lines 60-101).
# ---------------------------------------------------------------------------
MULTIAGENT_SUBAGENTS_OLD = """\
SUBAGENTS = [
    # Uncomment and configure the subagents you need. You must enable at least one.
    #
    # {
    #     "name": "genie",
    #     "type": "genie",
    #     "space_id": "<YOUR-GENIE-SPACE-ID>",  # UUID from the Genie space URL
    #     "description": (
    #         "Query a Genie space for structured data analysis. "
    #         "Use this for questions about data, metrics, and tables."
    #     ),
    # },
    # {
    #     "name": "app_agent",
    #     "type": "app",
    #     "endpoint": "<YOUR-APP-AGENT-NAME>",  # TODO: set to your Databricks App name
    #     "description": (
    #         "Query a specialist agent deployed as a Databricks App. "
    #         "Use this for questions the specialist app agent handles."
    #     ),
    # },
    # {
    #     "name": "knowledge_assistant",
    #     "type": "serving_endpoint",
    #     "endpoint": "<YOUR-KNOWLEDGE-ASSISTANT-ENDPOINT>",  # flat name, NOT a Vector Search index
    #     "description": (
    #         "Query the knowledge-assistant endpoint on Model Serving. "
    #         "Use this for knowledge-base / documentation lookups. "
    #         "The endpoint must have task type agent/v1/responses."
    #     ),
    # },
    # {
    #     "name": "serving_endpoint",
    #     "type": "serving_endpoint",
    #     "endpoint": "<YOUR-SERVING-ENDPOINT>",
    #     "description": (
    #         "Query a model hosted on a Databricks Model Serving endpoint. "
    #         "Use this for questions best answered by the serving model. "
    #         "The endpoint must have task type agent/v1/responses."
    #     ),
    # },
]"""


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
    knowledge_assistant_endpoint: str,
) -> list[FileEdit]:
    """Build pre_test_edits for multiagent, skipping already-configured values."""
    template_dir = _REPO_ROOT / template_name
    edits: list[FileEdit] = []

    # Only replace SUBAGENTS if the template still has the commented-out block
    agent_py = (template_dir / "agent_server" / "agent.py").read_text()
    if MULTIAGENT_SUBAGENTS_OLD in agent_py:
        edits.append(
            FileEdit(
                relative_path="agent_server/agent.py",
                old=MULTIAGENT_SUBAGENTS_OLD,
                new=_multiagent_subagents_new(genie_space_id, serving_endpoint),
            )
        )

    # Only replace databricks.yml placeholders if they exist
    yml_text = (template_dir / "databricks.yml").read_text()
    for old, new in [
        ("<YOUR-GENIE-SPACE-ID>", genie_space_id),
        ("<YOUR-SERVING-ENDPOINT>", serving_endpoint),
        ("<YOUR-KNOWLEDGE-ASSISTANT-ENDPOINT>", knowledge_assistant_endpoint),
    ]:
        if old in yml_text:
            edits.append(FileEdit(relative_path="databricks.yml", old=old, new=new))

    return edits


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[2]


def _parse_databricks_yml(template_name: str) -> tuple[str, str]:
    """Parse bundle_name and dev_app_name from a template's databricks.yml.

    Returns (bundle_name, dev_app_name) where dev_app_name is the app name
    with ${bundle.target} resolved to 'dev'.
    """
    yml_path = _REPO_ROOT / template_name / "databricks.yml"
    text = yml_path.read_text()

    bundle_match = re.search(r'^bundle:\s*\n\s*name:\s*(\S+)', text, re.MULTILINE)
    assert bundle_match, f"Could not find bundle name in {yml_path}"
    bundle_name = bundle_match.group(1)

    # Match the app name line under resources.apps (contains ${bundle.target})
    app_match = re.search(
        r'^\s*apps:\s*\n\s*\w+:\s*\n\s*name:\s*"([^"]+)"', text, re.MULTILINE
    )
    assert app_match, f"Could not find app name in {yml_path}"
    dev_app_name = app_match.group(1).replace("${bundle.target}", "dev")

    assert len(dev_app_name) <= 30, (
        f"App name '{dev_app_name}' is {len(dev_app_name)} chars (max 30) "
        f"in {yml_path}"
    )
    return bundle_name, dev_app_name


# ---------------------------------------------------------------------------
# Template builder
# ---------------------------------------------------------------------------
def build_templates(
    genie_space_id: str = DEFAULT_GENIE_SPACE_ID,
    serving_endpoint: str = DEFAULT_SERVING_ENDPOINT,
    knowledge_assistant_endpoint: str = DEFAULT_KNOWLEDGE_ASSISTANT_ENDPOINT,
) -> list[TemplateConfig]:
    configs: list[tuple[str, dict]] = [
        ("agent-langgraph", {}),
        ("agent-langgraph-short-term-memory", {"needs_lakebase_edit": True}),
        ("agent-langgraph-long-term-memory", {"needs_lakebase_edit": True}),
        ("agent-openai-agents-sdk", {}),
        (
            "agent-openai-agents-sdk-short-term-memory",
            {"needs_lakebase_edit": True},
        ),
        (
            "agent-openai-agents-sdk-multiagent",
            {
                "pre_test_edits": _multiagent_edits(
                    "agent-openai-agents-sdk-multiagent",
                    genie_space_id,
                    serving_endpoint,
                    knowledge_assistant_endpoint,
                ),
            },
        ),
        (
            "agent-non-conversational",
            {"is_conversational": False, "has_evaluate": False},
        ),
    ]

    templates = []
    for name, overrides in configs:
        bundle_name, dev_app_name = _parse_databricks_yml(name)
        templates.append(
            TemplateConfig(
                name=name,
                bundle_name=bundle_name,
                dev_app_name=dev_app_name,
                **overrides,
            )
        )
    return templates
