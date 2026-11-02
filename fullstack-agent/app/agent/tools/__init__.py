"""Agent tools collected by all_tools() from package modules."""

import importlib
import inspect
import pkgutil
from typing import Annotated

from agents import FunctionTool
from pydantic import Field

from agent.prompts import prompt

Step = Annotated[str, Field(description=prompt("step"))]


def all_tools() -> list[FunctionTool]:
    """Every FunctionTool defined across the modules in this package."""
    tools: list[FunctionTool] = []
    for module in pkgutil.iter_modules(__path__):
        # nosemgrep: non-literal-import -- names come from pkgutil over this package
        mod = importlib.import_module(f"{__name__}.{module.name}")
        for _, obj in inspect.getmembers(mod, lambda o: isinstance(o, FunctionTool)):
            if (
                obj not in tools
            ):  # a tool imported into several modules is collected once
                tools.append(obj)
    return tools
