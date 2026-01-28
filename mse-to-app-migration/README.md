# Model Serving to Databricks Apps Migration

Migrate MLflow ResponsesAgent from Databricks Model Serving to Databricks Apps.

## Overview

This repository provides instructions for LLM coding agents (Claude Code, Cursor, etc.) to migrate agents from Databricks Model Serving to Databricks Apps.

**Key files:**
- `AGENTS.md` - Comprehensive migration instructions for LLM agents
- `CLAUDE.md` - Loads AGENTS.md into Claude Code

## Quick Start

### Option 1: Use with Claude Code

```bash
# Navigate to this directory
cd mse-to-app-migration

# Start Claude Code - it will automatically load AGENTS.md via CLAUDE.md
claude

# Then ask Claude to migrate your endpoint:
# "Migrate my Model Serving endpoint 'my-agent-endpoint' to a Databricks App"
```

### Option 2: Use with Any LLM Agent

1. Copy the contents of `AGENTS.md` into your LLM agent's context
2. Ask it to migrate your endpoint, providing:
   - Endpoint name or the original agent code
   - Databricks workspace URL
   - Any specific requirements

### Option 3: Manual Migration

Follow the steps in `AGENTS.md` manually to understand and perform the migration.

## What Gets Migrated

| Model Serving | → | Apps |
|---------------|---|------|
| `class MyAgent(ResponsesAgent)` | → | `@invoke()` / `@stream()` decorated functions |
| `def predict()` (sync) | → | `async def non_streaming()` |
| `def predict_stream()` (sync generator) | → | `async def streaming()` (async generator) |
| `databricks_agents.deploy()` | → | `databricks apps deploy` |

## Helper Script (Optional)

A helper script is available to download your original agent code:

```bash
# Install dependencies
uv sync

# Download original agent artifacts
uv run migrate --endpoint <endpoint-name> --profile DEFAULT
```

This will:
1. Download the MLflow model artifacts to `./output/<app-name>/reference/`
2. Generate a basic app structure as a starting point

The LLM agent can then refactor the code following the AGENTS.md instructions.

## App Templates

The migration guide references templates from https://github.com/databricks/app-templates:

| Template | Use Case |
|----------|----------|
| `agent-langgraph` | Basic stateless agent |
| `agent-langgraph-short-term-memory` | Agents with conversation memory |
| `agent-langgraph-long-term-memory` | Agents with persistent user memory |
| `agent-non-conversational` | Single-response agents |
| `agent-openai-agents-sdk` | OpenAI Agents SDK based agents |

## Key Differences: Model Serving vs Apps

| Aspect | Model Serving | Apps |
|--------|--------------|------|
| Entry Point | `ResponsesAgent.predict()` / `predict_stream()` | `@invoke` / `@stream` decorators |
| Execution | Synchronous | Asynchronous |
| Server | MLflow Model Server | MLflow GenAI Server (FastAPI) |
| Deployment | `databricks_agents.deploy()` | `databricks apps deploy` |

## Resources

- [App Templates Repository](https://github.com/databricks/app-templates)
- [Responses API Documentation](https://mlflow.org/docs/latest/genai/serving/responses-agent/)
- [Agent Framework Documentation](https://docs.databricks.com/aws/en/generative-ai/agent-framework/)
