---
name: modify-agent
description: "Modify TypeScript LangChain agent configuration and behavior. Use when: (1) User wants to change agent settings, (2) Add/remove tools, (3) Update system prompt, (4) Change model parameters."
---

# Modify Agent

## Key Files

| File | Purpose | When to Edit |
|------|---------|--------------|
| `src/agent.ts` | Agent logic, tools, prompt | Change agent behavior |
| `src/tools.ts` | Tool definitions | Add/remove tools |
| `src/server.ts` | API server, endpoints | Change API behavior |
| `src/tracing.ts` | MLflow tracing config | Adjust tracing |
| `app.yaml` | Runtime configuration | Env vars, resources |
| `databricks.yml` | Bundle resources | Permissions, targets |
| `.env` | Local environment | Local development |

## Common Modifications

### 1. Change Model

**In `.env` (local):**
```bash
DATABRICKS_MODEL=databricks-gpt-5-2
```

**In `app.yaml` (deployed):**
```yaml
env:
  - name: DATABRICKS_MODEL
    value: "databricks-gpt-5-2"
```

Available models:
- `databricks-claude-sonnet-4-5`
- `databricks-gpt-5-2`
- `databricks-meta-llama-3-3-70b-instruct`
- Your custom endpoint name

### 2. Update System Prompt

Edit `src/agent.ts`:

```typescript
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant specialized in [YOUR DOMAIN].

Your key capabilities:
- [Capability 1]
- [Capability 2]

When answering:
- [Instruction 1]
- [Instruction 2]

Be concise but thorough.`;
```

Or pass custom prompt when creating agent:

```typescript
const agent = await createAgent({
  systemPrompt: "Your custom instructions here...",
});
```

### 3. Adjust Model Parameters

**Temperature** (0.0 = deterministic, 1.0 = creative):

`.env`:
```bash
TEMPERATURE=0.7
```

`app.yaml`:
```yaml
env:
  - name: TEMPERATURE
    value: "0.7"
```

**Max Tokens**:

`.env`:
```bash
MAX_TOKENS=4000
```

`app.yaml`:
```yaml
env:
  - name: MAX_TOKENS
    value: "4000"
```

**Use Responses API** (for citations, reasoning):

`.env`:
```bash
USE_RESPONSES_API=true
```

### 4. Add New Tools

#### Basic Function Tool

Edit `src/tools.ts`:

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const myCustomTool = tool(
  async ({ param1, param2 }) => {
    // Tool logic here
    return `Result: ${param1} and ${param2}`;
  },
  {
    name: "my_custom_tool",
    description: "Description of what this tool does",
    schema: z.object({
      param1: z.string().describe("Description of param1"),
      param2: z.number().describe("Description of param2"),
    }),
  }
);
```

Add to tool list:

```typescript
export function getBasicTools() {
  return [
    weatherTool,
    calculatorTool,
    timeTool,
    myCustomTool,  // Add here
  ];
}
```

#### MCP Tool Integration

**Enable Databricks SQL**:

`.env`:
```bash
ENABLE_SQL_MCP=true
```

`app.yaml`:
```yaml
env:
  - name: ENABLE_SQL_MCP
    value: "true"
```

**Add Unity Catalog Function**:

`.env`:
```bash
UC_FUNCTION_CATALOG=main
UC_FUNCTION_SCHEMA=default
UC_FUNCTION_NAME=my_function
```

`app.yaml`:
```yaml
env:
  - name: UC_FUNCTION_CATALOG
    value: "main"
  - name: UC_FUNCTION_SCHEMA
    value: "default"
  - name: UC_FUNCTION_NAME
    value: "my_function"
```

`databricks.yml` (add permission):
```yaml
resources:
  apps:
    agent_langchain_ts:
      resources:
        - name: uc-function
          function:
            name: "main.default.my_function"
            permission: EXECUTE
```

**Add Vector Search**:

`.env`:
```bash
VECTOR_SEARCH_CATALOG=main
VECTOR_SEARCH_SCHEMA=default
VECTOR_SEARCH_INDEX=my_index
```

**Add Genie Space**:

`.env`:
```bash
GENIE_SPACE_ID=01234567-89ab-cdef-0123-456789abcdef
```

### 5. Remove Tools

Edit `src/tools.ts`:

```typescript
export function getBasicTools() {
  return [
    weatherTool,
    // calculatorTool,  // Commented out to disable
    timeTool,
  ];
}
```

Or filter tools:

```typescript
export function getBasicTools() {
  const allTools = [weatherTool, calculatorTool, timeTool];
  return allTools.filter(t => t.name !== "calculator");
}
```

### 6. Customize Agent Behavior

The agent uses a manual agentic loop in `src/agent.ts`. Edit the `AgentMCP` class to customize:

```typescript
export class AgentMCP {
  private maxIterations: number; // Max tool call iterations (default: 10)

  // Customize in constructor or create() method
  static async create(config: AgentConfig = {}): Promise<AgentMCP> {
    // ...
    return new AgentMCP(
      modelWithTools,
      tools,
      systemPrompt,
      15  // ← Increase maxIterations for complex tasks
    );
  }
}
```

The manual agentic loop handles:
- Tool execution and result formatting
- Error handling for failed tool calls
- Iteration limits to prevent infinite loops

### 7. Add API Endpoints

Edit `src/server.ts`:

```typescript
// New endpoint example
app.post("/api/evaluate", async (req: Request, res: Response) => {
  const { input, expected } = req.body;

  const response = await invokeAgent(agent, input);

  // Custom evaluation logic
  const score = calculateScore(response.output, expected);

  res.json({
    input,
    output: response.output,
    expected,
    score,
  });
});
```

### 8. Modify MLflow Tracing

Edit `src/tracing.ts` or initialize with custom config in `src/server.ts`:

```typescript
const tracing = initializeMLflowTracing({
  serviceName: "my-custom-service",
  experimentId: process.env.MLFLOW_EXPERIMENT_ID,
  useBatchProcessor: false,  // Use simple processor for debugging
});
```

### 9. Change Port

`.env`:
```bash
PORT=3001
```

`app.yaml`:
```yaml
env:
  - name: PORT
    value: "3001"
```

### 10. Add Streaming Configuration

Edit `src/server.ts` to customize streaming behavior:

```typescript
if (stream) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");  // Disable buffering

  // Custom streaming logic
  try {
    for await (const chunk of streamAgent(agent, userInput, chatHistory)) {
      // Add custom formatting
      const formatted = {
        chunk,
        timestamp: Date.now(),
      };
      res.write(`data: ${JSON.stringify(formatted)}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    // Handle errors
  }
}
```

## Testing Changes

After modifying agent:

```bash
# Test locally
npm run dev

# Run tests
npm test

# Build to check for TypeScript errors
npm run build
```

## Deploying Changes

```bash
# Redeploy
databricks bundle deploy -t dev

# Restart app
databricks apps restart db-agent-langchain-ts-<username>

# View logs
databricks apps logs db-agent-langchain-ts-<username> --follow
```

## Advanced Modifications

### Custom LangChain Chain

Create custom chain in `src/agent.ts`:

```typescript
import { RunnableSequence } from "@langchain/core/runnables";

const customChain = RunnableSequence.from([
  // Add custom processing steps
  promptTemplate,
  model,
  outputParser,
]);
```

### Add Memory/State

Install LangGraph for stateful agents:

```bash
npm install @langchain/langgraph
```

Implement stateful agent:

```typescript
import { StateGraph } from "@langchain/langgraph";

// Define state
interface AgentState {
  messages: AgentMessage[];
  context: Record<string, any>;
}

// Create graph
const workflow = new StateGraph<AgentState>({
  channels: {
    messages: { value: (x, y) => x.concat(y) },
    context: { value: (x, y) => ({ ...x, ...y }) },
  },
});
```

### Add RAG with Vector Search

```typescript
import { DatabricksVectorSearch } from "@databricks/langchainjs";

const vectorStore = new DatabricksVectorSearch({
  index: "catalog.schema.index_name",
  textColumn: "text",
  columns: ["id", "text", "metadata"],
});

// Use in retrieval chain
const retriever = vectorStore.asRetriever({
  k: 5,
});
```

### Custom Authentication

Edit `src/server.ts`:

```typescript
// Add auth middleware
app.use((req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Validate token
  if (!isValidToken(token)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
});
```

### Error Handling

Add custom error handling in `src/server.ts`:

```typescript
// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Error:", err);

  // Log to MLflow
  // ...

  res.status(500).json({
    error: "Internal server error",
    message: err.message,
    timestamp: new Date().toISOString(),
  });
});
```

## TypeScript Best Practices

### Type Safety

Define interfaces for agent inputs/outputs:

```typescript
interface AgentInput {
  messages: AgentMessage[];
  config?: AgentConfig;
}

interface AgentOutput {
  message: AgentMessage;
  intermediateSteps?: ToolStep[];
  metadata?: Record<string, any>;
}
```

### Module Organization

Keep modules focused:
- `agent.ts`: Agent logic only
- `tools.ts`: Tool definitions only
- `server.ts`: API routes only
- `tracing.ts`: Tracing setup only

### Async/Await

Always handle promises properly:

```typescript
// Good
try {
  const result = await agent.invoke(input);
  return result;
} catch (error) {
  console.error("Agent error:", error);
  throw error;
}

// Bad
agent.invoke(input).then(result => {
  // ...
});
```

## Debugging

### Enable Debug Logging

The agent already includes comprehensive logging in `src/agent.ts`:

```typescript
// Tool execution logging (already included)
console.log(`✅ Agent initialized with ${tools.length} tool(s)`);
console.log(`   Tools: ${tools.map((t) => t.name).join(", ")}`);

// Add more logging in streamEvents() method
if (event.event === "on_tool_start") {
  console.log(`[Tool] Calling ${event.name} with:`, event.data?.input);
}
```

### Add Debug Logs

```typescript
console.log("Agent input:", input);
console.log("Tool calls:", response.intermediateSteps);
console.log("Final output:", response.output);
```

### Use TypeScript Compiler

Check for type errors:

```bash
npx tsc --noEmit
```

## Related Skills

- **quickstart**: Initial setup
- **run-locally**: Local testing
- **deploy**: Deploy changes to Databricks
