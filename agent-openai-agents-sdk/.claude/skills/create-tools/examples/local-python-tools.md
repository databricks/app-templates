# Local Python Function Tools

For operations that don't need external data sources or MCP servers, define tools directly in your agent code. These run in the same process as your agent — no resource creation or `databricks.yml` permissions needed.

## When to use local tools vs. MCP

- **Local tools**: Simple logic, API calls with custom auth, data transformations, utility functions
- **MCP tools**: When you need Databricks-managed auth, UC governance, or access to Databricks resources (tables, indexes, Genie)

## OpenAI Agents SDK

```python
from agents import Agent, function_tool

@function_tool
def get_current_time() -> str:
    """Get the current date and time in ISO format."""
    from datetime import datetime
    return datetime.now().isoformat()

@function_tool
def calculate_discount(price: float, percent: float) -> str:
    """Calculate a discounted price. Returns the new price after applying the discount."""
    discounted = price * (1 - percent / 100)
    return f"${discounted:.2f}"

agent = Agent(
    name="My agent",
    instructions="You are a helpful assistant.",
    model="databricks-claude-sonnet-4-5",
    tools=[get_current_time, calculate_discount],
)
```

## LangGraph

```python
from langchain_core.tools import tool

@tool
def get_current_time() -> str:
    """Get the current date and time in ISO format."""
    from datetime import datetime
    return datetime.now().isoformat()

@tool
def calculate_discount(price: float, percent: float) -> str:
    """Calculate a discounted price. Returns the new price after applying the discount."""
    discounted = price * (1 - percent / 100)
    return f"${discounted:.2f}"

# Pass to create_react_agent or add to your tools list
tools = [get_current_time, calculate_discount]
```

## Tips

- The docstring becomes the tool description the LLM sees — make it clear and specific
- Type annotations on parameters help the LLM provide correct arguments
- Local tools can call the Databricks SDK, external APIs, or any Python library
