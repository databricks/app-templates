# Agent LangGraph Development Guide

## Running the App

**Prerequisites:** uv, nvm (Node 20), Databricks CLI

**Quick Start:**
```bash
./scripts/quickstart.sh   # First-time setup (auth, MLflow experiment, env)
./scripts/start-app.sh    # Start app at http://localhost:8000
```

**Advanced Server Options:**
```bash
uv run start-server --reload   # Hot-reload on code changes
uv run start-server --port 8001
uv run start-server --workers 4
```

**Test API:**
```bash
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
```

---

## Modifying with databricks-langchain SDK

**SDK Location:** `~/databricks-ai-bridge/integrations/langchain`

**Development Workflow:**
```bash
pip install -e ~/databricks-ai-bridge/integrations/langchain  # Editable install
pytest ~/databricks-ai-bridge/integrations/langchain/tests    # Run tests
ruff format .                                                  # Format code
```

**Main file to modify:** `agent_server/agent.py`

---

### ChatDatabricks - LLM Chat Interface
Connects to Databricks Model Serving endpoints for LLM inference.
```python
from databricks_langchain import ChatDatabricks

llm = ChatDatabricks(
    endpoint="databricks-claude-3-7-sonnet",  # or databricks-meta-llama-3-1-70b-instruct
    temperature=0,
    max_tokens=500,
)

# For Responses API agents:
llm = ChatDatabricks(endpoint="my-agent-endpoint", use_responses_api=True)
```

---

### DatabricksEmbeddings - Generate Embeddings
Query Databricks embedding model endpoints.
```python
from databricks_langchain import DatabricksEmbeddings

embeddings = DatabricksEmbeddings(endpoint="databricks-bge-large-en")
vector = embeddings.embed_query("The meaning of life is 42")
vectors = embeddings.embed_documents(["doc1", "doc2"])
```

---

### DatabricksVectorSearch - Vector Store
Connect to Databricks Vector Search indexes for similarity search.
```python
from databricks_langchain import DatabricksVectorSearch

# Delta-sync index with Databricks-managed embeddings
vs = DatabricksVectorSearch(index_name="catalog.schema.index_name")

# Direct-access or self-managed embeddings
vs = DatabricksVectorSearch(
    index_name="catalog.schema.index_name",
    embedding=embeddings,
    text_column="content",
)

docs = vs.similarity_search("query", k=5)
```

---

### GenieAgent - Query Genie Spaces
Use a Genie space as a LangChain agent for natural language queries over data.
```python
from databricks_langchain.genie import GenieAgent

genie = GenieAgent(
    genie_space_id="your-space-id",
    genie_agent_name="SalesGenie",
    description="Sales data assistant for Europe region",
    include_context=True,  # Include SQL and reasoning in response
    return_pandas=True,    # Return DataFrames instead of markdown
)

# Use in LangGraph
result = await genie.ainvoke({"messages": [{"role": "user", "content": "What were Q4 sales?"}]})
```

---

### MCP Client - Tool Integration
Connect to MCP (Model Context Protocol) servers to get tools for your agent.

**Basic MCP Server (manual URL):**
```python
from databricks_langchain import DatabricksMCPServer, DatabricksMultiServerMCPClient

client = DatabricksMultiServerMCPClient([
    DatabricksMCPServer(
        name="system-ai",
        url=f"{host}/api/2.0/mcp/functions/system/ai",
        handle_tool_error=True,  # Return errors as strings instead of raising
    )
])
tools = await client.get_tools()
```

**From UC Function (convenience helper):**
Creates MCP server for Unity Catalog functions. If `function_name` is omitted, exposes all functions in the schema.
```python
server = DatabricksMCPServer.from_uc_function(
    catalog="main",
    schema="tools",
    function_name="send_email",  # Optional - omit for all functions in schema
    name="email-server",
    timeout=30.0,
    handle_tool_error=True,
)
```

**From Vector Search (convenience helper):**
Creates MCP server for Vector Search indexes. If `index_name` is omitted, exposes all indexes in the schema.
```python
server = DatabricksMCPServer.from_vector_search(
    catalog="main",
    schema="embeddings",
    index_name="product_docs",  # Optional - omit for all indexes in schema
    name="docs-search",
    timeout=30.0,
)
```

**Non-Databricks MCP Server:**
```python
from databricks_langchain import MCPServer

server = MCPServer(
    name="external-server",
    url="https://other-server.com/mcp",
    headers={"X-API-Key": "secret"},
    timeout=15.0,
)
```

---

## Agent Framework Capabilities

Reference: https://docs.databricks.com/aws/en/generative-ai/agent-framework/

### Tool Types
1. **Unity Catalog Function Tools** - SQL UDFs managed in UC with built-in governance
2. **Agent Code Tools** - Defined directly in agent code for REST APIs and low-latency operations
3. **MCP Tools** - Interoperable tools via Model Context Protocol (Databricks-managed, external, or self-hosted)

### Built-in Tools
- **system.ai.python_exec** - Execute Python code dynamically within agent queries (code interpreter)

### External Connection Tools
Connect to external services via Unity Catalog HTTP connections:
- **Slack** - Post messages to channels
- **Google Calendar** - Calendar operations
- **Microsoft Graph API** - Office 365 services
- **Azure AI Search** - Search functionality
- **Any HTTP API** - Use `http_request` from databricks-sdk

Example: Create UC function wrapping HTTP request for Slack, then expose via MCP.

### Common Patterns
- **Structured data retrieval** - Query SQL tables/databases
- **Unstructured data retrieval** - Document search and RAG via Vector Search
- **Code interpreter** - Python execution for analysis via system.ai.python_exec
- **External connections** - Integrate services like Slack via HTTP connections
