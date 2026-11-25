"""Guard against dependency regressions that only surface on a live model call."""

import importlib


def test_litellm_tool_calling_path_imports():
    # litellm.completion() imports this module whenever `tools` is passed, and this template
    # always passes tools. From litellm 1.106.0 it pulls in the proxy MCP catalog, which needs
    # `mcp>=2.2`; without it every request fails with "No module named 'mcp'". The template
    # depends on `google-adk[mcp]` (which allows mcp 2.x from google-adk 2.11.0) to provide it.
    importlib.import_module("litellm.responses.mcp.chat_completions_handler")


def test_adk_mcp_toolset_imports():
    # Databricks-hosted tools (UC functions, Genie, Vector Search) connect through MCPToolset,
    # which ships in the `mcp` extra the template installs by default.
    importlib.import_module("google.adk.tools.mcp_tool.mcp_toolset")
    importlib.import_module("google.adk.tools.mcp_tool.mcp_session_manager")
