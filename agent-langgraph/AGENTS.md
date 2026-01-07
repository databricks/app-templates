# Agent LangGraph Development Guide

## Running the App

**Prerequisites:** uv, nvm (Node 20), Databricks CLI

**Quick Start:**

```bash
./scripts/quickstart.sh   # First-time setup (auth, MLflow experiment, env)
uv run start-app          # Start app at http://localhost:8000
```

**Advanced Server Options:**

```bash
uv run start-server --reload   # Hot-reload on code changes during development
uv run start-server --port 8001
uv run start-server --workers 4
```

**Test API:**

```bash
# Streaming request
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'

# Non-streaming request
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }] }'
```

---

## Testing the Agent

**Run evaluation:**

```bash
uv run agent-evaluate     # Uses MLflow scorers (RelevanceToQuery, Safety)
```

**Run unit tests:**

```bash
pytest [path]             # Standard pytest execution
```

---

## Modifying the Agent

Anytime the user wants to modify the agent, look through each of the following resources to help them accomplish their goal:

If the user wants to convert something into Responses API, refer to https://mlflow.org/docs/latest/genai/serving/responses-agent/ for more information.

1. Look through existing databricks-langchain APIs to see if they can use one of these to accomplish their goal.
2. Look through the folders in https://github.com/bbqiu/agent-on-app-prototype to see if there's an existing example similar to what they're looking to do.
3. Reference the documentation available under https://docs.databricks.com/aws/en/generative-ai/agent-framework/ and its subpages.
4. For adding tools and capabilities, refer to: https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool
5. For stuff like LangGraph routing, configuration, and customization, refer to the LangGraph documentation: https://docs.langchain.com/oss/python/langgraph/overview.

**Main file to modify:** `agent_server/agent.py`

---

## databricks-langchain SDK overview

**SDK Location:** `https://github.com/databricks/databricks-ai-bridge/tree/main/integrations/langchain`

**Development Workflow:**

```bash
uv add databricks-langchain
```

Before making any changes, ensure that the APIs actually exist in the SDK. If something is missing from the documentation here, feel free to look in the venv's `site-packages` directory for the `databricks_langchain` package. If it's not installed, run `uv sync` in this folder to create the .venv and install the package.

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

### MCP Client - Tool Integration

Connect to MCP (Model Context Protocol) servers to get tools for your agent.

**Basic MCP Server (manual URL):**

```python
from databricks_langchain import DatabricksMCPServer, DatabricksMultiServerMCPClient

client = DatabricksMultiServerMCPClient([
    DatabricksMCPServer(
        name="system-ai",
        url=f"{host}/api/2.0/mcp/functions/system/ai",
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

**From Genie Space:**
Create MCP server from Genie Space. Need to get the genie space ID. Can prompt the user to retrieve this via the UI by getting the link to the genie space.

Ex: https://db-ml-models-dev-us-west.cloud.databricks.com/genie/rooms/01f0515f6739169283ef2c39b7329700?o=3217006663075879 means the genie space ID is 01f0515f6739169283ef2c39b7329700

```python
DatabricksMCPServer(
    name="genie",
    url=f"{host_name}/api/2.0/mcp/genie/01f0515f6739169283ef2c39b7329700",
),
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

### Stateful LangGraph agent

To enable statefulness in a LangGraph agent, we need to install `databricks-langchain[memory]`.

Look through the package files for the latest on stateful langgraph agents. Can start by looking at the databricks_langchain/checkpoints.py and databricks_langchain/store.py files.

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

---

## Authentication Setup

**Option 1: OAuth (Recommended)**

```bash
databricks auth login
```

Set in `.env.local`:

```bash
DATABRICKS_CONFIG_PROFILE=DEFAULT
```

**Option 2: Personal Access Token**

Set in `.env.local`:

```bash
DATABRICKS_HOST="https://host.databricks.com"
DATABRICKS_TOKEN="dapi_token"
```

---

## MLflow Experiment Setup

Create and link an MLflow experiment:

```bash
DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
databricks experiments create-experiment /Users/$DATABRICKS_USERNAME/agents-on-apps
```

Add the experiment ID to `.env.local`:

```bash
MLFLOW_EXPERIMENT_ID=<your-experiment-id>
```

---

## Key Files

| File                             | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `agent_server/agent.py`          | Agent logic, model, instructions, MCP servers |
| `agent_server/start_server.py`   | FastAPI server + MLflow setup                 |
| `agent_server/evaluate_agent.py` | Agent evaluation with MLflow scorers          |
| `agent_server/utils.py`          | Databricks auth helpers, stream processing    |
| `scripts/start_app.py`           | Manages backend+frontend startup              |

---

## Deploying to Databricks Apps

**Create app:**

```bash
databricks apps create agent-langgraph
```

**Sync files:**

```bash
DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
databricks sync . "/Users/$DATABRICKS_USERNAME/agent-langgraph"
```

**Deploy:**

```bash
databricks apps deploy agent-langgraph --source-code-path /Workspace/Users/$DATABRICKS_USERNAME/agent-langgraph
```

**Query deployed app:**

Generate OAuth token (PATs are not supported):

```bash
databricks auth token
```

Send request:

```bash
curl -X POST <app-url>/invocations \
  -H "Authorization: Bearer <oauth-token>" \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
```
