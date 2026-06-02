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
| `agent-langgraph` | A conversational agent using LangGraph and MLflow AgentServer | MLflow experiment |
| `agent-langgraph-advanced` | LangGraph agent with short-term memory, long-term memory, and long-running background tasks | MLflow experiment, Database |
| `agent-openai-agents-sdk` | A conversational agent using OpenAI Agents SDK and MLflow AgentServer | MLflow experiment |
| `agent-openai-advanced` | OpenAI Agents SDK agent with short-term memory and long-running background tasks | MLflow experiment, Database |
| `agent-openai-agents-sdk-multiagent` | Multi-agent orchestrator using OpenAI Agents SDK with Genie and serving endpoint subagents | MLflow experiment |
| `agent-non-conversational` | A non-conversational agent that processes structured questions and provides answers with detailed reasoning | MLflow experiment |
| `agent-migration-from-model-serving` | Template for migrating a ResponsesAgent from Model Serving to Databricks Apps | MLflow experiment |
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

### AppKit

A collection of templates for building full-stack Databricks Apps with [AppKit](https://github.com/databricks/appkit).

<!-- appkit-start -->

| Template | Description | Dependencies |
|----------|-------------|--------------|
| `appkit-all-in-one` | Full-stack Node.js app with SQL analytics dashboards, file browser, Genie AI conversations, and Lakebase Autoscaling (Postgres) CRUD | SQL warehouse, Volume, Genie Space, Database |
| `appkit-analytics` | Node.js app with SQL analytics dashboards and charts | SQL warehouse |
| `appkit-genie` | Node.js app with AI/BI Genie for natural language data queries | Genie Space |
| `appkit-files` | Node.js app with file browser for Databricks Volumes | Volume |
| `appkit-serving` | Node.js app with Databricks Model Serving endpoint integration | Serving Endpoint |
| `appkit-lakebase` | Node.js app with Lakebase Autoscaling (Postgres) CRUD operations | Database |

<!-- appkit-end -->

### Showcase Examples

End-to-end example apps that bundle a full Databricks App with seed data, SQL queries, and (where applicable) Lakeflow pipelines and provisioning scripts. See each template's `README.md` for the runbook.

| Template | Description | Dependencies |
|----------|-------------|--------------|
| `agentic-support-console` | End-to-end AI-powered support console combining Lakebase, Lakehouse Sync, a medallion pipeline, an LLM agent job, reverse sync, and a Databricks App with Genie analytics. | SQL warehouse, Database, Genie Space, MLflow experiment |
| `content-moderator` | Internal content moderation tool with per-channel guidelines, AI-powered compliance scoring via Model Serving, and a moderator review workflow backed by Lakebase and Genie analytics. | SQL warehouse, Database, Genie Space, Serving endpoint |
| `inventory-intelligence` | Retail inventory management with AI-powered demand forecasting, replenishment recommendations, and optional Genie analytics. Built on a live medallion pipeline synced to Lakebase. | SQL warehouse, Database, Genie Space |
| `rag-chat` | Streaming Retrieval-Augmented Generation chat app with pgvector retrieval from Lakebase, Wikipedia seed corpus, Model Serving generation, and Lakebase-backed chat history. Consumed via `databricks apps init`. | Database, Serving endpoint |
| `saas-tracker` | Internal tool for tracking team SaaS subscriptions, owners, costs, and renewals with Lakebase persistence and Genie spend analytics. | SQL warehouse, Database, Genie Space |
| `vacation-rentals` | Vacation rental ops dashboard with revenue analytics from a SQL Warehouse, a booking queue with Lakebase-backed flags and agent notes, and an embedded Genie chat panel. | SQL warehouse, Database, Genie Space |
