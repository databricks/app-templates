"""Agent tools package.

Every module here is auto-imported, and every ``FunctionTool`` it defines (via the OpenAI Agents
SDK ``@function_tool`` decorator) is collected by ``all_tools()``. Drop a new ``*.py`` into this
folder with a ``@function_tool``-decorated function and it's picked up automatically — no wiring to
edit. ``create_agent`` uses ``all_tools()``.
"""

import importlib
import inspect
import pkgutil

from agents import FunctionTool


def all_tools() -> list[FunctionTool]:
    """Every FunctionTool defined across the modules in this package."""
    tools: list[FunctionTool] = []
    for module in pkgutil.iter_modules(__path__):
        mod = importlib.import_module(f"{__name__}.{module.name}")
        for _, obj in inspect.getmembers(mod, lambda o: isinstance(o, FunctionTool)):
            if obj not in tools:  # a tool imported into several modules is collected once
                tools.append(obj)
    return tools
