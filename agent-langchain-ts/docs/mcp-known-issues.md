# MCP Tools - Known Issues

## Issue: MCP Tools Fail with LangChain AgentExecutor

### Status
🔴 **BLOCKED** - Awaiting fix in `@databricks/langchainjs` or `@langchain/mcp-adapters`

### Summary
MCP tools (Databricks SQL, UC Functions, Vector Search, Genie) **can be loaded and called directly**, but **fail when used within LangChain's AgentExecutor**.

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

### Root Cause Analysis

The issue appears to be in how LangChain's AgentExecutor integrates with MCP tools:

1. **Tool Format Mismatch**: MCP tools might not conform to LangChain's expected tool interface
2. **Result Serialization**: Tool results might not be properly serialized back to the model
3. **Client Lifecycle**: MCP client might need special handling in agent context

### Attempted Fixes

❌ **Keep MCP Client Alive Globally**
- Created `globalMCPClient` variable
- Result: No change, still fails

❌ **Enable Responses API**
- Set `USE_RESPONSES_API=true`
- Result: No change, still fails

❌ **Different Model (Claude vs Llama)**
- Tested with both `databricks-claude-sonnet-4-5` and `databricks-meta-llama-3-3-70b-instruct`
- Result: Both fail with MCP tools

### Workaround

For now, **basic tools work fine**. Users can:

1. Use the 3 built-in basic tools (weather, calculator, time)
2. Add custom LangChain tools using `DynamicStructuredTool`
3. Wait for MCP agent integration fix

**Example - Custom SQL Tool (Workaround):**
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const sqlTool = tool(
  async ({ query }) => {
    // Use Databricks SDK SQL execution directly
    const result = await executeSQLDirectly(query);
    return JSON.stringify(result);
  },
  {
    name: "execute_sql",
    description: "Execute SQL queries on Databricks",
    schema: z.object({
      query: z.string().describe("SQL query to execute"),
    }),
  }
);
```

### Next Steps

1. **File Issue**: Report to `@databricks/langchainjs` or `@langchain/mcp-adapters`
2. **Monitor Updates**: Check for package updates that fix agent integration
3. **Alternative Approach**: Consider using `model.bindTools(tools)` directly instead of AgentExecutor

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

**Last Updated:** 2026-02-08
**Issue Status:** Open - Awaiting upstream fix
**Impact:** MCP tools unusable in agent, but direct invocation works
