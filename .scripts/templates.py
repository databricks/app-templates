"""Shared template configuration for sync scripts."""

TEMPLATES = {
    "agent-langgraph": {
        "sdk": "langgraph",
        "bundle_name": "agent_langgraph",
    },
    "agent-langgraph-short-term-memory": {
        "sdk": "langgraph",
        "bundle_name": "agent_langgraph_short_term_memory",
    },
    "agent-langgraph-long-term-memory": {
        "sdk": "langgraph",
        "bundle_name": "agent_langgraph_long_term_memory",
    },
    "agent-openai-agents-sdk": {
        "sdk": "openai",
        "bundle_name": "agent_openai_agents_sdk",
    },
    "agent-openai-agents-sdk-multiagent": {
        "sdk": "openai",
        "bundle_name": "agent_openai_agents_sdk_multiagent",
    },
    "agent-openai-agents-sdk-short-term-memory": {
        "sdk": "openai",
        "bundle_name": "agent_openai_agents_sdk_short_term_memory",
    },
    "agent-non-conversational": {
        "sdk": "langgraph",
        "bundle_name": "agent_non_conversational",
        "exclude_scripts": ["start_app.py", "evaluate_agent.py"],
    },
    "agent-migration-from-model-serving": {
        "sdk": ["langgraph", "openai"],
        "bundle_name": "agent_migration",
    },
}
