"""Sample tool. A working example — add your own tools as new files in this package.

Decorate a function with ``@function_tool`` (OpenAI Agents SDK) and it becomes an agent tool; the
package auto-collects it via ``all_tools()``, which ``create_agent`` uses.
"""

from datetime import datetime

from agents import function_tool


@function_tool
def get_current_time() -> str:
    """Get the current date and time."""
    return datetime.now().isoformat()
