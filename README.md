# Databricks App Templates

Pre-built templates for creating [Databricks Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/). Each template includes working code, configuration, and setup instructions to get started quickly.

## Templates

### AI Agents
Build conversational AI agents with REST APIs and built-in chat UIs.

| Template | Description |
|----------|-------------|
| `agent-openai-agents-sdk` | Agent using OpenAI Agents SDK with code interpreter |
| `agent-langgraph` | Agent using LangGraph for LLM workflows |
| `agent-langgraph-short-term-memory` | LangGraph agent with conversation history (Lakebase) |
| `agent-langgraph-long-term-memory` | LangGraph agent with persistent user memory (Lakebase) |
| `agent-non-conversational` | Document analysis agent for structured Q&A |

### Data Apps
Interactive dashboards and analytics apps connected to Databricks SQL warehouses.

| Template | Framework | Features |
|----------|-----------|----------|
| `streamlit-data-app` | Streamlit | SQL warehouse, data visualization |
| `dash-data-app` | Dash/Plotly | SQL warehouse, interactive charts |
| `gradio-data-app` | Gradio | SQL warehouse, dynamic inputs |
| `shiny-data-app` | Shiny | SQL warehouse, async queries |
| `*-data-app-obo-user` | Various | On-behalf-of user authentication |

### Chatbots
Chat interfaces connected to Databricks serving endpoints.

| Template | Framework |
|----------|-----------|
| `streamlit-chatbot-app` | Streamlit |
| `dash-chatbot-app` | Dash |
| `gradio-chatbot-app` | Gradio |
| `shiny-chatbot-app` | Shiny |
| `e2e-chatbot-app-next` | React + Express (full-stack) |

### Database Apps
Apps with PostgreSQL/Lakebase integration for CRUD operations.

| Template | Framework |
|----------|-----------|
| `streamlit-database-app` | Streamlit |
| `dash-database-app` | Dash |
| `flask-database-app` | Flask |

### Hello World
Minimal starter templates for each framework.

`streamlit-hello-world-app` · `dash-hello-world-app` · `gradio-hello-world-app` · `shiny-hello-world-app` · `flask-hello-world-app`

### MCP Servers
Model Context Protocol server templates for building AI agent tools.

| Template | Description |
|----------|-------------|
| `mcp-server-hello-world` | Basic MCP server example |
| `mcp-server-open-api-spec` | MCP server from OpenAPI spec |

## Getting Started

### From Databricks UI
1. Click **New** → **App** in the sidebar
2. Select a template
3. Configure resources and deploy

### From CLI
```bash
# Clone the repo
git clone https://github.com/databricks/app-templates.git

# Navigate to a template
cd app-templates/streamlit-data-app

# Follow the template's README for setup
```

## Template Structure

Each template includes:
- `app.yaml` - App configuration and environment variables
- `README.md` - Setup and development instructions
- Source code for the specific framework
- `requirements.txt` (Python) or `package.json` (Node.js)

Agent templates additionally include:
- `databricks.yml` - Databricks Asset Bundle configuration
- `.claude/skills/` - AI-assisted development guides
- `scripts/quickstart.py` - Automated setup script

## Resources

- [Databricks Apps Documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)
- [Create an App from a Template](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/create-app-template)
