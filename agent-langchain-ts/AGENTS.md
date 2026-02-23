# TypeScript Agent Development Guide

Complete guide for building LangChain agents with MLflow tracing on Databricks.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- Databricks workspace access
- Databricks CLI installed

### One-Command Setup
```bash
npm run quickstart
```

This will:
1. Configure Databricks authentication
2. Install dependencies
3. Set up environment variables
4. Initialize your agent project

---

## 📁 Project Structure

```
agent-langchain-ts/
├── src/
│   ├── agent.ts              # ✏️  EDIT: LangChain agent setup, system prompt
│   ├── tools.ts              # ✏️  EDIT: Tool definitions (add your own here)
│   ├── mcp-servers.ts        # ✏️  EDIT: Connect to Databricks resources via MCP
│   └── framework/            # Infrastructure — no need to modify
│       ├── server.ts         #   Express server, agent init, health endpoint
│       ├── tracing.ts        #   MLflow/OpenTelemetry tracing
│       └── routes/
│           └── invocations.ts #  Responses API endpoint, SSE streaming
├── ui/                       # e2e-chatbot-app-next (auto-fetched)
├── tests/
│   ├── agent.test.ts         # ✏️  EDIT: Tests for your agent logic
│   ├── integration.test.ts   # ✏️  EDIT: Tests for agent behavior
│   ├── e2e/                  # End-to-end tests (deployed app)
│   │   ├── deployed.test.ts  # ✏️  EDIT: Tests for deployed agent
│   │   └── framework/        # Framework e2e tests — no need to modify
│   └── framework/            # Framework unit tests — no need to modify
├── databricks.yml            # Bundle config & permissions
├── app.yaml                  # Databricks Apps config
├── package.json              # Dependencies & scripts
└── tsconfig.json             # TypeScript configuration
```

---

## 🏗️ Architecture

### Agent-First Design

```
Production (Port 8000):
┌────────────────────────────────────────┐
│ Agent Server (Exposed)                 │
│ ├─ /invocations (Responses API)       │  ← Direct agent access
│ ├─ /api/* (proxy to UI:3000)          │  ← UI backend routes
│ └─ /* (static UI files)                │  ← React frontend
└────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────┐
│ UI Backend (Internal Port 3000)        │
│ ├─ /api/chat (useChat format)         │
│ ├─ /api/session (session management)  │
│ └─ /api/config (configuration)        │
└────────────────────────────────────────┘
```

### Local Development

```
Terminal 1: Agent (Port 5001)          Terminal 2: UI (Port 3001)
┌────────────────────────┐             ┌────────────────────────┐
│ npm run dev:agent      │◄────proxy───│ npm run dev:ui         │
│ /invocations           │             │ /api/chat              │
└────────────────────────┘             └────────────────────────┘
```

---

## 🛠️ Development Workflow

### 1. Initial Setup

**Check authentication status:**
```bash
databricks auth profiles
```

**If no profiles exist, run quickstart:**
```bash
npm run quickstart
```

**Or set up manually:**
```bash
# Install dependencies
npm install

# Configure Databricks authentication
databricks auth login --profile your-profile

# Copy environment template
cp .env.example .env

# Edit .env with your settings
nano .env
```

### 2. Run Locally

**Start both servers (recommended):**
```bash
npm run dev
```

This runs both agent and UI servers with hot-reload.

**Or start individually:**
```bash
# Terminal 1: Agent only
npm run dev:agent

# Terminal 2: UI only
npm run dev:ui
```

**Or agent-only mode (no UI):**
```bash
PORT=5001 npm run dev:agent
```

**Access:**
- Agent endpoint: http://localhost:5001/invocations
- UI: http://localhost:3000
- UI backend: http://localhost:3001/api/chat

### 3. Test Locally

**Run all tests:**
```bash
npm run test:all
```

**Run specific test suites:**
```bash
npm run test:unit              # Agent unit tests
npm run test:integration       # Local endpoint tests
npm run test:error-handling    # Error scenario tests
```

**Test agent endpoint directly:**
```bash
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "What time is it in Tokyo?"}],
    "stream": true
  }'
```

**Test with TypeScript:**
```typescript
import { createDatabricksProvider } from "@databricks/ai-sdk-provider";
import { streamText } from "ai";

const databricks = createDatabricksProvider({
  baseURL: "http://localhost:5001",
  formatUrl: ({ baseUrl, path }) => {
    if (path === "/responses") {
      return `${baseUrl}/invocations`;
    }
    return `${baseUrl}${path}`;
  },
});

const result = streamText({
  model: databricks.responses("test-model"),
  messages: [{ role: "user", content: "Calculate 123 * 456" }],
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

### 4. Modify Agent

**Change agent configuration** (`src/agent.ts`):
```typescript
// The agent uses standard LangGraph createReactAgent API
export async function createAgent(config: AgentConfig = {}) {
  const {
    model: modelName = "databricks-claude-sonnet-4-5",
    temperature = 0.1,
    maxTokens = 2000,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    mcpServers,
  } = config;

  // Create chat model
  const model = new ChatDatabricks({
    model: modelName,
    temperature,
    maxTokens,
  });

  // Load tools (basic + MCP if configured)
  const tools = await getAllTools(mcpServers);

  // Create agent using standard LangGraph API
  const agent = createReactAgent({
    llm: model,
    tools,
  });

  return new StandardAgent(agent, systemPrompt);
}
```

Note: The agent uses LangGraph's `createReactAgent()` which provides automatic tool calling, built-in agentic loop with reasoning, and streaming support out of the box.

**Add custom tools** (`src/tools.ts`):
```typescript
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const myCustomTool = new DynamicStructuredTool({
  name: "my_custom_tool",
  description: "Does something useful",
  schema: z.object({
    input: z.string().describe("Input parameter"),
  }),
  func: async ({ input }) => {
    // Your tool logic here
    return `Processed: ${input}`;
  },
});

// Add to basicTools export
export const basicTools = [weatherTool, calculatorTool, timeTool, myCustomTool];
```

**Change model/temperature** (`.env`):
```bash
DATABRICKS_MODEL=databricks-claude-sonnet-4-5
TEMPERATURE=0.1
MAX_TOKENS=2000
```

### 5. Deploy to Databricks

**Build everything:**
```bash
npm run build
```

**Deploy:**
```bash
databricks bundle deploy
databricks bundle run agent_langchain_ts
```

**Check status:**
```bash
databricks apps get agent-lc-ts-dev
```

**View logs:**
```bash
databricks apps logs agent-lc-ts-dev --follow
```

### 6. Test Deployed App

**Get OAuth token:**
```bash
databricks auth token --profile your-profile
```

**Test /invocations endpoint:**
```bash
TOKEN=$(databricks auth token --profile your-profile | jq -r '.access_token')
APP_URL=$(databricks apps get agent-lc-ts-dev --output json | jq -r '.url')

curl -X POST "$APP_URL/invocations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

**Test UI:**
```bash
# Get app URL
databricks apps get agent-lc-ts-dev --output json | jq -r '.url'

# Open in browser (will prompt for Databricks login)
open $(databricks apps get agent-lc-ts-dev --output json | jq -r '.url')
```

**Run deployed tests:**
```bash
APP_URL=<your-app-url> npm run test:deployed
```

---

## 🔧 Key Files to Modify

### Agent Logic (`src/agent.ts`)
**What**: Define agent behavior, system prompt, model configuration
**When**: Changing how the agent thinks, adding tools, adjusting parameters

```typescript
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant...`;

export async function createAgent(config: AgentConfig = {}) {
  // Customize agent here
}
```

### Tools (`src/tools.ts`)
**What**: Define functions the agent can call
**When**: Adding new capabilities (API calls, data retrieval, computations)

```typescript
export const basicTools = [
  weatherTool,      // Get weather for a location
  calculatorTool,   // Evaluate math expressions
  timeTool,         // Get current time in timezone
  // Add your tools here
];
```

### Server Configuration (`src/framework/server.ts`)
**What**: HTTP server setup, endpoints, middleware
**When**: Adding routes, changing ports, modifying request handling
**Note**: Most users don't need to touch this — it lives under `src/framework/` intentionally

### Deployment (`databricks.yml`)
**What**: Databricks bundle configuration, resources, permissions
**When**: Granting access to resources, changing app name, configuring variables

```yaml
resources:
  apps:
    agent_langchain_ts:
      name: agent-lc-ts-${var.resource_name_suffix}
      resources:
        - name: serving-endpoint
          serving_endpoint:
            name: ${var.serving_endpoint_name}
            permission: CAN_QUERY
```

---

## 📊 MLflow Tracing

All agent interactions are automatically traced to MLflow for debugging and evaluation.

**View traces:**
1. Go to your Databricks workspace
2. Navigate to Experiments
3. Find experiment ID from deployment
4. Click on runs to see traces with:
   - Input/output
   - Tool calls
   - Latency metrics
   - Token usage

**Configure tracing** (`.env`):
```bash
MLFLOW_TRACKING_URI=databricks
MLFLOW_EXPERIMENT_ID=your-experiment-id
```

---

## 🎯 Common Tasks

### Add Databricks MCP Tools

The agent supports **Model Context Protocol (MCP)** tools that connect to Databricks resources. See [docs/ADDING_TOOLS.md](docs/ADDING_TOOLS.md) for the complete guide.

**Available MCP Tools:**
- **Databricks SQL** - Direct SQL queries on Unity Catalog tables
- **UC Functions** - Call Unity Catalog functions as agent tools
- **Vector Search** - Semantic search for RAG applications
- **Genie Spaces** - Natural language data queries

**Quick Example - Enable Databricks SQL:**

1. **Enable in `.env`**:
```bash
ENABLE_SQL_MCP=true
```

2. **Grant permissions in `databricks.yml`**:
```yaml
resources:
  apps:
    agent_langchain_ts:
      resources:
        - name: catalog-schema
          schema:
            schema_name: main.default
            permission: USE_SCHEMA
        - name: my-table
          table:
            table_name: main.default.customers
            permission: SELECT
```

3. **Test**:
```bash
npm run dev:agent

# In another terminal
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "Query the customers table"}],
    "stream": false
  }'
```

4. **Deploy**:
```bash
npm run build
databricks bundle deploy
databricks bundle run agent_langchain_ts
```

See [docs/ADDING_TOOLS.md](docs/ADDING_TOOLS.md) for more examples including Vector Search (RAG), UC Functions, and Genie Spaces.

### Add a REST API Tool

```typescript
const apiTool = new DynamicStructuredTool({
  name: "fetch_data",
  description: "Fetches data from external API",
  schema: z.object({
    endpoint: z.string().describe("API endpoint to call"),
  }),
  func: async ({ endpoint }) => {
    const response = await fetch(`https://api.example.com/${endpoint}`);
    return await response.json();
  },
});
```

### Change System Prompt

Edit `src/agent.ts`:
```typescript
const DEFAULT_SYSTEM_PROMPT = `You are a data analyst assistant.
You have access to tools for querying databases and visualizing data.
Always provide clear explanations of your analysis.`;
```

### Adjust Model Temperature

Edit `.env`:
```bash
TEMPERATURE=0.7  # Higher = more creative, Lower = more deterministic
```

---

## 🐛 Troubleshooting

### Agent not starting
```bash
# Check if port is in use
lsof -ti:5001 | xargs kill -9

# Rebuild
npm run build:agent

# Check logs
npm run dev:agent
```

### Tests failing
```bash
# Ensure servers are running
npm run dev  # In separate terminal

# Run tests
npm run test:integration
```

### Deployment errors
```bash
# Check bundle validation
databricks bundle validate

# Check app logs
databricks apps logs agent-lc-ts-dev --follow

# Check app status
databricks apps get agent-lc-ts-dev
```

### UI not loading
```bash
# Rebuild UI
npm run build:ui

# Check if UI files exist
ls -la ui/client/dist
ls -la ui/server/dist
```

---

## 📚 Resources

- **LangChain.js Docs**: https://js.langchain.com/docs/
- **Vercel AI SDK**: https://sdk.vercel.ai/docs
- **Databricks AI SDK Provider**: https://github.com/databricks/ai-sdk-provider
- **MLflow Tracing**: https://mlflow.org/docs/latest/llms/tracing/index.html
- **Databricks Apps**: https://docs.databricks.com/en/dev-tools/databricks-apps/

---

## 💡 Best Practices

1. **Test locally first** - Always test `/invocations` before deploying
2. **Use MLflow traces** - Monitor agent behavior and debug issues
3. **Version control** - Commit `databricks.yml` and source code
4. **Secure credentials** - Never commit `.env` files
5. **Grant minimal permissions** - Only add resources agent needs
6. **Write tests** - Add tests for custom tools and logic
7. **Monitor costs** - Check model serving endpoint usage

---

## 🤝 Getting Help

- Check existing skills in `.claude/skills/` for specific tasks
- Review test files in `tests/` for usage examples
- Check CLAUDE.md for development workflow details
- Review Python agent template for comparison: `agent-openai-agents-sdk`

---

**Last Updated**: 2026-02-08
**Template Version**: 1.0.0
