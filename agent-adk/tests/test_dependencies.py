"""Guard against dependency regressions that only surface on a live model call."""

import importlib


def test_litellm_tool_calling_path_imports_without_mcp():
    # litellm.completion() imports this module whenever `tools` is passed, and this template
    # always passes tools. From litellm 1.106.0 it pulls in the proxy MCP catalog, which needs
    # `mcp>=2.2` -- incompatible with google-adk's MCP extra (`mcp<2`). Every request then fails
    # with "No module named 'mcp'". See the litellm pin in pyproject.toml.
    importlib.import_module("litellm.responses.mcp.chat_completions_handler")
