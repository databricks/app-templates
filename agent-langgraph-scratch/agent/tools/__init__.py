"""Agent tools package.

Every module here is auto-imported, and every LangChain ``BaseTool`` it defines (via the
``@tool`` decorator) is collected by ``all_tools()``. Drop a new ``*.py`` into this folder with a
``@tool``-decorated function and it's picked up automatically — no wiring to edit.
``create_agent_graph`` uses ``all_tools()``.
"""

import importlib
import inspect
import pkgutil

from langchain_core.tools import BaseTool


def all_tools() -> list[BaseTool]:
    """Every BaseTool defined across the modules in this package."""
    tools: list[BaseTool] = []
    for module in pkgutil.iter_modules(__path__):
        mod = importlib.import_module(f"{__name__}.{module.name}")
        for _, obj in inspect.getmembers(mod, lambda o: isinstance(o, BaseTool)):
            if obj not in tools:  # a tool imported into several modules is collected once
                tools.append(obj)
    return tools
