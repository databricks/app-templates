from dataclasses import dataclass, field


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

MULTIAGENT_SUBAGENTS_NEW = """\
SUBAGENTS = [
    {
        "name": "genie",
        "type": "genie",
        "space_id": "01f05202dbb51d74b6cccf1b1b1683eb",
        "description": (
            "Query a Genie space for structured data analysis. "
            "Use this for questions about data, metrics, and tables."
        ),
    },
    {
        "name": "serving_endpoint",
        "type": "serving_endpoint",
        "endpoint": "agents_dev-bbqiu-test-bb-2-25",
        "description": (
            "Query a model hosted on a Databricks Model Serving endpoint. "
            "Use this for questions best answered by the serving model. "
            "The endpoint must have task type agent/v1/responses."
        ),
    },
]"""


TEMPLATES = [
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
                new=MULTIAGENT_SUBAGENTS_NEW,
            ),
            FileEdit(
                relative_path="databricks.yml",
                old="<YOUR-GENIE-SPACE-ID>",
                new="01f05202dbb51d74b6cccf1b1b1683eb",
            ),
            FileEdit(
                relative_path="databricks.yml",
                old="<YOUR-SERVING-ENDPOINT>",
                new="agents_dev-bbqiu-test-bb-2-25",
            ),
            FileEdit(
                relative_path="databricks.yml",
                old="<YOUR-KNOWLEDGE-ASSISTANT-ENDPOINT>",
                new="agents_dev-bbqiu-test-bb-2-25",
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
