# MCP Tools - Implementation Notes

## Status: ✅ RESOLVED

The agent now uses the standard LangChain.js manual agentic loop pattern, which works correctly with MCP tools.

## Previous Issue (RESOLVED)

Previously, MCP tools failed when used with LangChain's `AgentExecutor`. This has been resolved by switching to the manual agentic loop pattern using `model.bindTools()`.

### Evidence

**✅ MCP Tools Work Directly:**
```typescript
// This WORKS
const sqlServer = new DatabricksMCPServer({ name: "dbsql", path: "/api/2.0/mcp/sql" });
const mcpServers = await buildMCPServerConfig([sqlServer]);
const client = new MultiServerMCPClient({ mcpServers });
const tools = await client.getTools();

const readOnlyTool = tools.find((t) => t.name.includes("read_only"));
const result = await readOnlyTool.invoke({ query: "SHOW TABLES IN main.default" });
// Returns: {"statement_id": "...", "status": {...}}
```

**❌ MCP Tools Fail in Agent:**
```typescript
// This FAILS
const agent = await createAgent({
  model: "databricks-claude-sonnet-4-5",
  mcpConfig: { enableSql: true },
});

const result = await agent.invoke({
  input: "Execute SQL: SHOW TABLES IN main.default",
});
// Returns: {output: ""} with error: AI_MissingToolResultsError
```

### Error Details

**Error Name:** `AI_MissingToolResultsError`

**Error Location:** Appears in `response_metadata.error` from Chat Databricks model response

**Tool Call Flow:**
1. Claude model generates tool call (e.g., `dbsql__execute_sql_read_only`)
2. Tool call has ID (e.g., `toolu_bdrk_01KjTczDuQn2nC6S1bv4PsD9`)
3. LangChain AgentExecutor attempts to execute tool
4. Tool result is not properly returned to the model
5. Model responds with `AI_MissingToolResultsError`
6. Agent returns empty output

### Tests

**Direct MCP Tool Test (PASSES):**
```bash
npx tsx test-mcp-direct.ts
# ✅ Tool execution succeeded!
# Result: {"statement_id":"...","status":{"state":"FAILED",...}}
```

**Agent with MCP Tools Test (FAILS):**
```bash
npx tsx test-agent-mcp.ts
# Test 2: SQL MCP tool
# ✅ SQL result:
# Full output:   # <-- Empty!
```

**Integration Test (FAILS):**
```bash
curl -X POST http://localhost:5001/invocations \
  -d '{"input":[{"role":"user","content":"Execute SQL: SHOW TABLES"}],"stream":false}'
# {"output":""}
```

## Solution

✅ **Manual Agentic Loop Pattern** (implemented in `src/agent.ts`):

```typescript
// Standard LangChain.js pattern
const model = new ChatDatabricks({ model: "databricks-claude-sonnet-4-5" });
const tools = await getAllTools(mcpServers); // Loads basic + MCP tools
const modelWithTools = model.bindTools(tools); // Bind tools to model

// Manual agentic loop
const messages = [new SystemMessage(systemPrompt), new HumanMessage(input)];
let response = await modelWithTools.invoke(messages);

while (response.tool_calls && response.tool_calls.length > 0) {
  messages.push(response); // Add AI message with tool calls

  // Execute each tool call
  for (const toolCall of response.tool_calls) {
    const tool = tools.find(t => t.name === toolCall.name);
    const result = await tool.invoke(toolCall.args);

    // Add tool result as ToolMessage
    messages.push(new ToolMessage({
      content: JSON.stringify(result),
      tool_call_id: toolCall.id,
      name: toolCall.name,
    }));
  }

  response = await modelWithTools.invoke(messages);
}
```

This pattern:
- ✅ Works with both basic tools and MCP tools
- ✅ Provides explicit control over tool execution
- ✅ Handles errors transparently
- ✅ Compatible with Responses API format

### Documentation Status

- ✅ MCP tools documentation created (docs/ADDING_TOOLS.md)
- ✅ Example configurations provided (.env.mcp-example, databricks.mcp-example.yml)
- ✅ Test suite created (tests/mcp-tools.test.ts)
- ⚠️  Tests will skip if MCP not working
- ⚠️  Users informed of current limitation

### Package Versions

```json
{
  "@databricks/langchainjs": "^0.1.0",
  "@langchain/mcp-adapters": "^1.1.1",
  "langchain": "^0.3.20"
}
```

---

**Last Updated:** 2026-02-10
**Status:** ✅ RESOLVED - Using manual agentic loop pattern
**Implementation:** `src/agent.ts` uses standard LangChain.js APIs
