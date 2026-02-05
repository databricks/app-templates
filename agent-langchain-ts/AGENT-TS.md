# TypeScript LangChain Agent Development Guide

## Quick Reference

This is a TypeScript agent template using [@databricks/langchainjs](https://github.com/databricks/databricks-ai-bridge/tree/main/integrations/langchainjs) with automatic MLflow tracing.

## Getting Started

**First-time setup:**
```bash
npm run quickstart
```

**Local development:**
```bash
npm run dev
```

**Deploy to Databricks:**
```bash
databricks bundle deploy -t dev
```

## Available Skills

Skills are located in `.claude/skills/` directory. Each skill contains tested commands and patterns.

| Skill | Purpose | When to Use |
|-------|---------|-------------|
| **quickstart** | Setup & authentication | First-time setup, configuration |
| **run-locally** | Local development | Testing, debugging locally |
| **deploy** | Deploy to Databricks | Push to production |
| **modify-agent** | Change agent config | Add tools, modify behavior |

## Quick Commands

| Task | Command |
|------|---------|
| Setup | `npm run quickstart` |
| Install deps | `npm install` |
| Dev server | `npm run dev` |
| Build | `npm run build` |
| Test | `npm test` |
| Deploy | `databricks bundle deploy -t dev` |
| View logs | `databricks apps logs <app-name> --follow` |

## Key Files

| File | Purpose |
|------|---------|
| `src/agent.ts` | Agent setup, tools, prompt |
| `src/server.ts` | Express API server |
| `src/tools.ts` | Tool definitions (basic + MCP) |
| `src/tracing.ts` | OpenTelemetry MLflow tracing |
| `app.yaml` | Databricks App runtime config |
| `databricks.yml` | Bundle config & resources |
| `.env` | Local environment variables |

## TypeScript Agent Features

### LangChain Integration

Uses `ChatDatabricks` from `@databricks/langchainjs`:

```typescript
import { ChatDatabricks } from "@databricks/langchainjs";

const model = new ChatDatabricks({
  model: "databricks-claude-sonnet-4-5",
  temperature: 0.1,
  maxTokens: 2000,
});
```

### MLflow Tracing

Automatic trace export via OpenTelemetry:

```typescript
import { initializeMLflowTracing } from "./tracing.js";

const tracing = initializeMLflowTracing({
  serviceName: "langchain-agent-ts",
  experimentId: process.env.MLFLOW_EXPERIMENT_ID,
});
```

All LangChain operations (LLM calls, tool invocations) are automatically traced to MLflow.

### Tool Types

1. **Basic Function Tools** - JavaScript/TypeScript functions with Zod schemas
2. **MCP Tools** - Databricks SQL, Unity Catalog, Vector Search, Genie Spaces

**Example tool:**
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const weatherTool = tool(
  async ({ location }) => {
    return `Weather in ${location}: sunny, 72°F`;
  },
  {
    name: "get_weather",
    description: "Get current weather for a location",
    schema: z.object({
      location: z.string().describe("City and state, e.g. 'San Francisco, CA'"),
    }),
  }
);
```

### Express API

REST API with streaming support:

- `GET /health` - Health check
- `POST /api/chat` - Agent invocation (streaming or non-streaming)

**Example request:**
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is the weather in SF?"}
    ],
    "stream": false
  }'
```

## MCP Tool Configuration

### Databricks SQL

Query tables via SQL:

`.env`:
```bash
ENABLE_SQL_MCP=true
```

### Unity Catalog Functions

Use UC functions as tools:

`.env`:
```bash
UC_FUNCTION_CATALOG=main
UC_FUNCTION_SCHEMA=default
UC_FUNCTION_NAME=my_function
```

`databricks.yml`:
```yaml
resources:
  - name: uc-function
    function:
      name: "main.default.my_function"
      permission: EXECUTE
```

### Vector Search

Query vector indexes:

`.env`:
```bash
VECTOR_SEARCH_CATALOG=main
VECTOR_SEARCH_SCHEMA=default
VECTOR_SEARCH_INDEX=my_index
```

### Genie Spaces

Natural language data queries:

`.env`:
```bash
GENIE_SPACE_ID=your-space-id
```

## Development Workflow

1. **Setup**: `npm run quickstart`
2. **Code**: Edit `src/agent.ts`, `src/tools.ts`
3. **Test**: `npm run dev` → test with curl
4. **Deploy**: `databricks bundle deploy -t dev`
5. **Monitor**: View logs and MLflow traces

## TypeScript vs Python Agents

| Aspect | TypeScript | Python |
|--------|------------|--------|
| **Package Manager** | npm | uv |
| **LangChain SDK** | `@databricks/langchainjs` | `databricks-langchain` |
| **Model Class** | `ChatDatabricks` | `ChatDatabricks` |
| **Server** | Express | FastAPI |
| **Tracing** | OpenTelemetry | OpenTelemetry |
| **Tool Definition** | Zod schemas | Pydantic models |
| **Deployment** | Same (DAB) | Same (DAB) |

## Resources

- [README.md](./README.md) - Detailed documentation
- [@databricks/langchainjs](https://github.com/databricks/databricks-ai-bridge/tree/main/integrations/langchainjs)
- [LangChain.js](https://js.langchain.com/)
- [MLflow Tracing](https://mlflow.org/docs/latest/llm-tracking.html)
- [Databricks Apps](https://docs.databricks.com/en/dev-tools/databricks-apps/index.html)

## Troubleshooting

### Common Issues

**"Module not found"**
```bash
npm install
```

**"Port already in use"**
```bash
lsof -ti:8000 | xargs kill -9
```

**"Authentication failed"**
```bash
databricks auth login
npm run quickstart
```

**"MLflow traces not appearing"**
- Check `MLFLOW_EXPERIMENT_ID` in `.env`
- Verify experiment exists
- Check server logs for tracing initialization

For detailed troubleshooting, see the relevant skill file in `.claude/skills/`.

## Next Steps

1. Read [README.md](./README.md) for comprehensive documentation
2. Run `npm run quickstart` to set up your environment
3. Review `.claude/skills/` for detailed guides on each task
4. Check `src/` files to understand the code structure
