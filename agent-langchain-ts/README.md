# LangChain TypeScript Agent with MLflow Tracing

A production-ready TypeScript agent template using [@databricks/langchainjs](https://github.com/databricks/databricks-ai-bridge/tree/main/integrations/langchainjs) with automatic MLflow tracing via OpenTelemetry.

## Features

- 🤖 **LangChain Agent**: Tool-calling agent using ChatDatabricks
- 📊 **MLflow Tracing**: Automatic trace export via OpenTelemetry
- 🔧 **Multiple Tools**: Built-in tools + MCP integration (SQL, UC Functions, Vector Search)
- 🚀 **Express API**: REST API with streaming support
- 📦 **TypeScript**: Full type safety with modern ES modules
- ☁️ **Databricks Deployment**: Ready for Databricks Apps platform

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- Databricks workspace with Model Serving enabled
- Databricks CLI configured

### Installation

```bash
npm install
```

### Configuration

Copy the environment template and configure your settings:

```bash
cp .env.example .env
```

Edit `.env` with your Databricks credentials:

```env
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=dapi...
DATABRICKS_MODEL=databricks-claude-sonnet-4-5
MLFLOW_EXPERIMENT_ID=your-experiment-id
```

### Local Development

```bash
# Start the server
npm run dev

# Server will be available at http://localhost:8000
```

### Test the Agent

```bash
# Health check
curl http://localhost:8000/health

# Chat (non-streaming)
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is the weather in San Francisco?"}
    ]
  }'

# Chat (streaming)
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Calculate 25 * 48"}
    ],
    "stream": true
  }'
```

## Architecture

### Project Structure

```
agent-langchain-ts/
├── src/
│   ├── agent.ts        # Agent setup and execution
│   ├── server.ts       # Express API server
│   ├── tracing.ts      # OpenTelemetry MLflow tracing
│   └── tools.ts        # Tool definitions (basic + MCP)
├── scripts/
│   └── quickstart.ts   # Setup wizard
├── tests/
│   └── agent.test.ts   # Unit tests
├── app.yaml            # Databricks App runtime config
├── databricks.yml      # Databricks Asset Bundle config
├── package.json
├── tsconfig.json
└── README.md
```

### Components

#### 1. **ChatDatabricks Model** (`src/agent.ts`)

The agent uses `ChatDatabricks` from `@databricks/langchainjs`:

```typescript
import { ChatDatabricks } from "@databricks/langchainjs";

const model = new ChatDatabricks({
  model: "databricks-claude-sonnet-4-5",
  temperature: 0.1,
  maxTokens: 2000,
});
```

#### 2. **MLflow Tracing** (`src/tracing.ts`)

Automatic trace export to MLflow via OpenTelemetry:

```typescript
import { initializeMLflowTracing } from "./tracing.js";

const tracing = initializeMLflowTracing({
  serviceName: "langchain-agent-ts",
  experimentId: process.env.MLFLOW_EXPERIMENT_ID,
});
```

All LangChain operations (LLM calls, tool invocations, chain executions) are automatically traced.

#### 3. **Tools** (`src/tools.ts`)

**Basic Tools:**
- `get_weather`: Weather lookup
- `calculator`: Mathematical expressions
- `get_current_time`: Current time in any timezone

**MCP Tools** (optional):
- Databricks SQL queries
- Unity Catalog functions
- Vector Search
- Genie Spaces

#### 4. **Express Server** (`src/server.ts`)

REST API with:
- `GET /health`: Health check
- `POST /api/chat`: Agent invocation (streaming or non-streaming)

## Tool Configuration

### Basic Tools Only

Default configuration includes weather, calculator, and time tools.

### Adding MCP Tools

#### Databricks SQL

Enable SQL queries via MCP:

```env
ENABLE_SQL_MCP=true
```

#### Unity Catalog Functions

Use UC functions as tools:

```env
UC_FUNCTION_CATALOG=main
UC_FUNCTION_SCHEMA=default
UC_FUNCTION_NAME=my_function  # Optional: specific function
```

#### Vector Search

Query vector search indexes:

```env
VECTOR_SEARCH_CATALOG=main
VECTOR_SEARCH_SCHEMA=default
VECTOR_SEARCH_INDEX=my_index  # Optional: specific index
```

#### Genie Spaces

Integrate with Genie data understanding:

```env
GENIE_SPACE_ID=your-space-id
```

## Deployment to Databricks

### 1. Validate Configuration

```bash
databricks bundle validate -t dev
```

### 2. Deploy the App

```bash
databricks bundle deploy -t dev
```

### 3. View Deployment

```bash
databricks apps list
databricks apps get db-agent-langchain-ts-<username>
```

### 4. View Logs

```bash
databricks apps logs db-agent-langchain-ts-<username> --follow
```

### 5. View Traces in MLflow

Navigate to your workspace:
```
/Users/<username>/agent-langchain-ts
```

Traces will appear in the experiment with:
- Request/response data
- Tool invocations
- Latency metrics
- Token usage

## API Reference

### POST /api/chat

Invoke the agent with a conversation.

**Request Body:**
```typescript
{
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  stream?: boolean;  // Default: false
  config?: {
    temperature?: number;
    maxTokens?: number;
  };
}
```

**Response (Non-streaming):**
```typescript
{
  message: {
    role: "assistant";
    content: string;
  };
  intermediateSteps?: Array<{
    action: string;
    observation: string;
  }>;
}
```

**Response (Streaming):**

Server-Sent Events (SSE) stream:
```
data: {"chunk": "Hello"}
data: {"chunk": " there"}
data: {"done": true}
```

## Development

### Build

```bash
npm run build
```

Output in `dist/` directory.

### Test

```bash
npm test
```

### Lint & Format

```bash
npm run lint
npm run format
```

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABRICKS_HOST` | Databricks workspace URL | Required |
| `DATABRICKS_TOKEN` | Personal access token | Required |
| `DATABRICKS_MODEL` | Model endpoint name | `databricks-claude-sonnet-4-5` |
| `USE_RESPONSES_API` | Use Responses API | `false` |
| `TEMPERATURE` | Model temperature (0-1) | `0.1` |
| `MAX_TOKENS` | Max generation tokens | `2000` |
| `MLFLOW_TRACKING_URI` | MLflow tracking URI | `databricks` |
| `MLFLOW_EXPERIMENT_ID` | Experiment ID for traces | Required |
| `PORT` | Server port | `8000` |

### Model Options

Available Databricks foundation models:
- `databricks-claude-sonnet-4-5`
- `databricks-gpt-5-2`
- `databricks-meta-llama-3-3-70b-instruct`

Or use your own custom model serving endpoint.

## Troubleshooting

### Authentication Issues

Ensure your Databricks CLI is configured:
```bash
databricks auth login --host https://your-workspace.cloud.databricks.com
```

### MLflow Traces Not Appearing

Check:
1. `MLFLOW_EXPERIMENT_ID` is set correctly
2. You have `CAN_MANAGE` permission on the experiment
3. Tracing initialized successfully (check logs)

### MCP Tools Not Loading

Verify:
1. MCP environment variables are set correctly
2. You have appropriate permissions for the resources
3. Check server logs for specific errors

## Learn More

- [@databricks/langchainjs SDK](https://github.com/databricks/databricks-ai-bridge/tree/main/integrations/langchainjs)
- [LangChain.js Documentation](https://js.langchain.com/)
- [MLflow Tracing](https://mlflow.org/docs/latest/llm-tracking.html)
- [OpenTelemetry](https://opentelemetry.io/)
- [Databricks Apps](https://docs.databricks.com/en/dev-tools/databricks-apps/index.html)

## License

Apache 2.0
