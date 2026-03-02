from dataclasses import dataclass, field

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


# ---------------------------------------------------------------------------
# Template builder
# ---------------------------------------------------------------------------
def build_templates(
    genie_space_id: str = DEFAULT_GENIE_SPACE_ID,
    serving_endpoint: str = DEFAULT_SERVING_ENDPOINT,
    knowledge_assistant_endpoint: str = DEFAULT_KNOWLEDGE_ASSISTANT_ENDPOINT,
) -> list[TemplateConfig]:
    return [
        TemplateConfig(
            name="agent-langgraph",
            bundle_name="agent_langgraph",
            dev_app_name="dev-agent-langgraph",
        ),
        TemplateConfig(
            name="agent-langgraph-short-term-memory",
            bundle_name="agent_langgraph_short_term_memory",
            dev_app_name="dev-agent-langgraph-short-term-memory",
            needs_lakebase_edit=True,
        ),
        TemplateConfig(
            name="agent-langgraph-long-term-memory",
            bundle_name="agent_langgraph_long_term_memory",
            dev_app_name="dev-agent-langgraph-long-term-memory",
            needs_lakebase_edit=True,
        ),
        TemplateConfig(
            name="agent-openai-agents-sdk",
            bundle_name="agent_openai_agents_sdk",
            dev_app_name="dev-agent-openai-agents-sdk",
        ),
        TemplateConfig(
            name="agent-openai-agents-sdk-short-term-memory",
            bundle_name="agent_openai_agents_sdk_short_term_memory",
            dev_app_name="dev-agent-openai-agents-sdk-short-term-memory",
            needs_lakebase_edit=True,
        ),
        TemplateConfig(
            name="agent-openai-agents-sdk-multiagent",
            bundle_name="agent_openai_agents_sdk_multiagent",
            dev_app_name="dev-agent-openai-agents-sdk-multiagent",
            pre_test_edits=[
                FileEdit(
                    relative_path="agent_server/agent.py",
                    old=MULTIAGENT_SUBAGENTS_OLD,
                    new=_multiagent_subagents_new(genie_space_id, serving_endpoint),
                ),
                FileEdit(
                    relative_path="databricks.yml",
                    old="<YOUR-GENIE-SPACE-ID>",
                    new=genie_space_id,
                ),
                FileEdit(
                    relative_path="databricks.yml",
                    old="<YOUR-SERVING-ENDPOINT>",
                    new=serving_endpoint,
                ),
                FileEdit(
                    relative_path="databricks.yml",
                    old="<YOUR-KNOWLEDGE-ASSISTANT-ENDPOINT>",
                    new=knowledge_assistant_endpoint,
                ),
            ],
        ),
        TemplateConfig(
            name="agent-non-conversational",
            bundle_name="agent_non_conversational",
            dev_app_name="dev-agent-non-conversational",
            is_conversational=False,
            has_evaluate=False,
        ),
    ]
