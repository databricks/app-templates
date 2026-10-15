"""Shared template configuration for sync scripts."""

TEMPLATES = {
    "agent-langgraph": {
        "sdk": "langgraph",
        "bundle_name": "agent_langgraph",
        "has_actions": True,
    },
    "agent-langgraph-advanced": {
        "sdk": "langgraph",
        "bundle_name": "agent_langgraph_advanced",
        "has_memory": True,
        "has_actions": True,
    },
    "agent-openai-agents-sdk": {
        "sdk": "openai",
        "bundle_name": "agent_openai_agents_sdk",
        "has_actions": True,
    },
    "agent-openai-agents-sdk-multiagent": {
        "sdk": "openai",
        "bundle_name": "agent_openai_agents_sdk_multiagent",
        "has_actions": True,
    },
    "agent-openai-advanced": {
        "sdk": "openai",
        "bundle_name": "agent_openai_advanced",
        "has_memory": True,
        "has_actions": True,
    },
    "agent-non-conversational": {
        "sdk": "langgraph",
        "bundle_name": "agent_non_conversational",
        "exclude_scripts": ["start_app.py", "evaluate_agent.py", "preflight.py"],
        "exclude_load_testing": True,
    },
    "agent-migration-from-model-serving": {
        "sdk": ["langgraph", "openai"],
        "bundle_name": "agent_migration",
    },
}
