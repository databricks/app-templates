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
| `src/main.ts` | Unified server entry point | Change server config |
| `src/plugins/agent/AgentPlugin.ts` | Agent routes, initialization | Modify agent endpoints |
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

**For adding MCP tools (SQL, Vector Search, Genie, UC Functions), see the [add-tools skill](../add-tools/SKILL.md).**

MCP tools are configured in `src/mcp-servers.ts` with required permissions in `databricks.yml`.

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

The agent uses standard LangGraph `createReactAgent` API in `src/agent.ts`:

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";

export async function createAgent(config: AgentConfig = {}) {
  // Create chat model
  const model = new ChatDatabricks({
    model: modelName,
    useResponsesApi,
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

The LangGraph agent automatically handles:
- Tool calling and execution
- Multi-turn reasoning with state management
- Error handling and retries
- Streaming support out of the box

### 7. Add API Endpoints

Edit `src/plugins/agent/AgentPlugin.ts` in the `injectRoutes()` method:

```typescript
injectRoutes(app: Application): void {
  // Existing routes
  app.get('/health', ...);
  app.use('/invocations', ...);

  // Add custom endpoint
  app.post("/api/evaluate", async (req: Request, res: Response) => {
    const { input, expected } = req.body;

    const response = await this.agent.invoke(input);

    // Custom evaluation logic
    const score = calculateScore(response.output, expected);

    res.json({
      input,
      output: response.output,
      expected,
      score,
    });
  });
}
```

### 8. Modify MLflow Tracing

Edit `src/tracing.ts` or pass custom config to AgentPlugin in `src/main.ts`:

```typescript
const agentPluginConfig: AgentPluginConfig = {
  agentConfig: { /* ... */ },
  experimentId: process.env.MLFLOW_EXPERIMENT_ID,
  serviceName: 'my-custom-service',
};

pluginManager.register(new AgentPlugin(agentPluginConfig));
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

Streaming is handled by `src/routes/invocations.ts`. To customize, edit that file or create a custom router in your plugin.

The default implementation uses the Responses API format with Server-Sent Events (SSE).

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

See the [deploy skill](../deploy/SKILL.md) for complete deployment instructions.

## Advanced Modifications

For advanced LangChain patterns (custom chains, stateful agents, RAG), see:
- [LangChain.js Documentation](https://js.langchain.com/docs/)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraphjs/)

### Add RAG with Vector Search

Use `DatabricksVectorSearch` from `@databricks/langchainjs`. See [LangChain Vector Store docs](https://js.langchain.com/docs/modules/data_connection/vectorstores/).

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
- `plugins/agent/AgentPlugin.ts`: Agent routes and initialization
- `routes/invocations.ts`: /invocations endpoint logic
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
