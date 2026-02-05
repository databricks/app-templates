# Databricks App Templates

Pre-built templates for creating [Databricks Apps](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/).

See [Create an App from a Template](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/create-app-template) to get started.

## Templates

### Hello World

| Template | Description | Dependencies |
|----------|-------------|--------------|
| `streamlit-hello-world-app` | Simple Streamlit app | None |
| `dash-hello-world-app` | Simple Dash app | None |
| `gradio-hello-world-app` | Simple Gradio app | None |
| `shiny-hello-world-app` | Simple Shiny app | None |
| `flask-hello-world-app` | Simple Flask app | None |
| `nodejs-fastapi-hello-world-app` | Simple Node.js app | None |

### Agents

| Template | Description | Dependencies |
|----------|-------------|--------------|
| `agent-openai-agents-sdk` | A conversational agent backend and UI using OpenAI Agents SDK and MLflow AgentServer | MLflow experiment |
| `agent-langgraph` | A conversational agent backend and UI using LangGraph and MLflow AgentServer | MLflow experiment |
| `agent-langgraph-short-term-memory` | LangGraph agent with conversation history | MLflow experiment, Database |
| `agent-langgraph-long-term-memory` | LangGraph agent with persistent user memory | MLflow experiment, Database |
| `agent-non-conversational` | A non-conversational GenAI agent that processes structured questions and provides answers with detailed reasoning | MLflow experiment |
| `e2e-chatbot-app-next` | A chat UI that queries a remote agent endpoint or foundation model | Serving endpoint |
| `mcp-server-hello-world` | A basic MCP server | None |
| `mcp-server-open-api-spec` | An MCP server that exposes REST API operations from an OpenAPI specification stored in a Unity Catalog volume | UC volume |

### Dashboard

| Template | Description | Dependencies |
|----------|-------------|--------------|
| `streamlit-data-app` | An app that reads from a SQL warehouse and visualizes data | SQL warehouse |
| `dash-data-app` | An app that reads from a SQL warehouse and visualizes data | SQL warehouse |
| `gradio-data-app` | An app that reads from a SQL warehouse and visualizes data | SQL warehouse |
| `shiny-data-app` | An app that reads from a SQL warehouse and visualizes data | SQL warehouse |

### Database

| Template | Description | Dependencies |
|----------|-------------|--------------|
| `streamlit-database-app` | A todo app that stores tasks in a Postgres database hosted on Databricks | Database |
| `dash-database-app` | A todo app that stores tasks in a Postgres database hosted on Databricks | Database |
| `flask-database-app` | A todo app that stores tasks in a Postgres database hosted on Databricks | Database |
