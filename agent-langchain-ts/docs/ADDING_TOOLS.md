# Adding Databricks Tools to Your TypeScript Agent

This guide shows how to add Databricks-authenticated tools to your LangChain TypeScript agent using the Model Context Protocol (MCP).

## Overview

The TypeScript agent supports four types of Databricks MCP tools:

| Tool Type | Use Case | MCP URL Pattern |
|-----------|----------|-----------------|
| **Databricks SQL** | Execute SQL queries on Unity Catalog tables | `/api/2.0/mcp/sql` |
| **UC Functions** | Call Unity Catalog functions as tools | `/api/2.0/mcp/functions/{catalog}/{schema}` |
| **Vector Search** | Semantic search over embeddings for RAG | `/api/2.0/mcp/vector-search/{catalog}/{schema}/{index}` |
| **Genie Spaces** | Natural language data queries | `/api/2.0/mcp/genie/{space_id}` |

## Quick Start

### 1. Enable Tools in `.env`

Edit your `.env` file to enable the tools you want:

```bash
# Enable Databricks SQL for direct table queries
ENABLE_SQL_MCP=true

# Enable Unity Catalog function
UC_FUNCTION_CATALOG=main
UC_FUNCTION_SCHEMA=default
UC_FUNCTION_NAME=get_customer_info

# Enable Vector Search for RAG
VECTOR_SEARCH_CATALOG=main
VECTOR_SEARCH_SCHEMA=default
VECTOR_SEARCH_INDEX=product_docs_index

# Enable Genie Space for natural language queries
GENIE_SPACE_ID=01234567-89ab-cdef-0123-456789abcdef
```

### 2. Grant Permissions in `databricks.yml`

Add the required resources to your `databricks.yml`:

```yaml
resources:
  apps:
    agent_langchain_ts:
      name: agent-lc-ts-${var.resource_name_suffix}
      resources:
        # Existing: model serving endpoint
        - name: serving-endpoint
          serving_endpoint:
            name: ${var.serving_endpoint_name}
            permission: CAN_QUERY

        # Add: Unity Catalog schema for SQL queries
        - name: catalog-schema
          schema:
            schema_name: main.default
            permission: USE_SCHEMA

        # Add: Specific table permission
        - name: customers-table
          table:
            table_name: main.default.customers
            permission: SELECT

        # Add: UC Function permission
        - name: uc-function
          registered_model:
            model_name: main.default.get_customer_info
            permission: EXECUTE

        # Add: Vector Search index permission
        - name: vector-index
          quality_monitor:
            table_name: main.default.product_docs_index
            permission: CAN_VIEW

        # Add: Genie Space permission
        - name: genie-space
          quality_monitor:
            table_name: genie.space.01234567-89ab-cdef-0123-456789abcdef
            permission: CAN_EDIT
```

### 3. Test Locally

```bash
# Start agent with MCP tools
npm run dev:agent

# Test in another terminal
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "Query the customers table for all customers"}],
    "stream": true
  }'
```

### 4. Deploy

```bash
npm run build
databricks bundle deploy
databricks bundle run agent_langchain_ts
```

## Detailed Configuration

### Databricks SQL MCP

**Use case**: Let the agent execute SQL queries directly on Unity Catalog tables.

**Configuration**:
```bash
# .env
ENABLE_SQL_MCP=true
```

**Required permissions** (`databricks.yml`):
```yaml
resources:
  - name: catalog-schema
    schema:
      schema_name: main.default
      permission: USE_SCHEMA

  - name: customers-table
    table:
      table_name: main.default.customers
      permission: SELECT
```

**Example agent query**:
> "Show me all customers from California"

The agent will:
1. Use the SQL MCP tool to query `main.default.customers`
2. Filter for `state = 'CA'`
3. Return formatted results

### Unity Catalog Functions

**Use case**: Expose custom business logic as agent tools.

**Setup**:
1. Create a UC function in your workspace:
```sql
CREATE FUNCTION main.default.get_customer_info(customer_id STRING)
RETURNS STRING
LANGUAGE PYTHON
AS $$
  # Your function logic here
  return f"Customer info for {customer_id}"
$$;
```

2. Configure in `.env`:
```bash
UC_FUNCTION_CATALOG=main
UC_FUNCTION_SCHEMA=default
UC_FUNCTION_NAME=get_customer_info
```

3. Grant permissions (`databricks.yml`):
```yaml
resources:
  - name: uc-function
    registered_model:
      model_name: main.default.get_customer_info
      permission: EXECUTE
```

**Example agent query**:
> "Get information for customer ID 12345"

### Vector Search (RAG)

**Use case**: Enable semantic search over your documents for retrieval-augmented generation.

**Setup**:
1. Create a vector search index (via Databricks UI or API)

2. Configure in `.env`:
```bash
VECTOR_SEARCH_CATALOG=main
VECTOR_SEARCH_SCHEMA=default
VECTOR_SEARCH_INDEX=product_docs_index
```

3. Grant permissions (`databricks.yml`):
```yaml
resources:
  - name: vector-index
    quality_monitor:
      table_name: main.default.product_docs_index
      permission: CAN_VIEW
```

**Example agent query**:
> "Find documentation about authentication"

The agent will:
1. Use vector search to find relevant docs
2. Retrieve top matches
3. Synthesize answer from retrieved context

### Genie Spaces

**Use case**: Let users query data using natural language without writing SQL.

**Setup**:
1. Create a Genie Space in your Databricks workspace

2. Get the Space ID:
```bash
databricks api /api/2.0/genie/spaces/list
```

3. Configure in `.env`:
```bash
GENIE_SPACE_ID=01234567-89ab-cdef-0123-456789abcdef
```

4. Grant permissions (`databricks.yml`):
```yaml
resources:
  - name: genie-space
    quality_monitor:
      table_name: genie.space.01234567-89ab-cdef-0123-456789abcdef
      permission: CAN_EDIT
```

**Example agent query**:
> "What was our revenue last quarter?"

## Customizing Tool Behavior

### Modify System Prompt

Edit `src/agent.ts` to customize how the agent uses tools:

```typescript
const DEFAULT_SYSTEM_PROMPT = `You are a data analyst assistant.

When answering questions about data:
1. Use SQL queries to get exact numbers
2. Use vector search to find relevant documentation
3. Use UC functions for complex business logic
4. Always cite your sources

Format responses with clear headings and bullet points.`;
```

### Add Custom MCP Tools

If you have custom MCP servers, add them in `src/tools.ts`:

```typescript
export async function getMCPTools(config: MCPConfig) {
  const servers: any[] = [];

  // ... existing servers ...

  // Add custom MCP server
  if (config.customMcp) {
    servers.push(
      new DatabricksMCPServer({
        name: "my-custom-mcp",
        path: `/api/2.0/mcp/custom/${config.customMcp.name}`,
      })
    );
  }

  // ... rest of function ...
}
```

## Testing MCP Tools

### Unit Tests

Create tests for your tools in `tests/mcp-tools.test.ts`:

```typescript
import { describe, test, expect, beforeAll } from "@jest/globals";
import { createAgent } from "../src/agent.js";

describe("MCP Tools", () => {
  test("should query database using SQL MCP", async () => {
    const agent = await createAgent({
      mcpConfig: {
        enableSql: true,
      },
    });

    const result = await agent.invoke({
      input: "How many customers are in the database?",
    });

    expect(result.output).toContain("customers");
  }, 60000);

  test("should call UC function", async () => {
    const agent = await createAgent({
      mcpConfig: {
        ucFunction: {
          catalog: "main",
          schema: "default",
          functionName: "get_customer_info",
        },
      },
    });

    const result = await agent.invoke({
      input: "Get info for customer 12345",
    });

    expect(result.output).toBeTruthy();
  }, 60000);
});
```

### Integration Tests

Test the deployed agent with MCP tools:

```bash
#!/bin/bash
# test-mcp-deployed.sh

APP_URL=$(databricks apps get agent-lc-ts-dev --output json | jq -r '.url')
TOKEN=$(databricks auth token --profile dogfood | jq -r '.access_token')

# Test SQL MCP
echo "Testing SQL MCP..."
curl -X POST "$APP_URL/invocations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "Query the customers table"}],
    "stream": false
  }' | jq .

# Test Vector Search
echo "Testing Vector Search..."
curl -X POST "$APP_URL/invocations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "Find docs about authentication"}],
    "stream": false
  }' | jq .
```

## Troubleshooting

### "Permission denied" errors

**Problem**: Agent gets 403 errors when calling tools

**Solution**: Check `databricks.yml` has all required resource permissions
```bash
databricks bundle validate
databricks bundle deploy
```

### "MCP server not responding"

**Problem**: MCP tools fail to load

**Solution**:
1. Verify resource exists:
```bash
# For UC function
databricks api /api/2.0/unity-catalog/functions/main.default.get_customer_info

# For Vector Search
databricks api /api/2.0/vector-search/indexes/main.default.product_docs_index
```

2. Check logs:
```bash
databricks apps logs agent-lc-ts-dev --follow
```

### "Tool not found in agent"

**Problem**: Agent doesn't see the MCP tool

**Solution**:
1. Verify `.env` configuration
2. Restart local server: `npm run dev:agent`
3. Check agent logs for "Loaded X MCP tools" message

### "Vector search returns no results"

**Problem**: Vector search tool returns empty results

**Solution**:
1. Verify index has embeddings:
```bash
databricks api /api/2.0/vector-search/indexes/main.default.product_docs_index
```

2. Check index sync status
3. Try a broader query

## Best Practices

1. **Grant minimal permissions**: Only add resources the agent actually needs
2. **Test locally first**: Verify MCP tools work before deploying
3. **Monitor costs**: MCP tool calls count toward model serving usage
4. **Use specific UC functions**: Rather than broad SQL access, create focused functions
5. **Add tool descriptions**: Clear descriptions help the agent choose the right tool
6. **Handle errors gracefully**: MCP tools may fail - agent should recover
7. **Cache embeddings**: For vector search, ensure index stays synced

## Examples

### Example 1: Data Analyst Agent

```bash
# .env
ENABLE_SQL_MCP=true
GENIE_SPACE_ID=your-genie-space-id
```

```yaml
# databricks.yml
resources:
  - name: sales-schema
    schema:
      schema_name: main.sales
      permission: USE_SCHEMA
  - name: sales-table
    table:
      table_name: main.sales.transactions
      permission: SELECT
```

**Capabilities**: Query sales data, generate reports, answer business questions

### Example 2: Customer Support Agent

```bash
# .env
UC_FUNCTION_CATALOG=main
UC_FUNCTION_SCHEMA=support
UC_FUNCTION_NAME=get_customer_history
VECTOR_SEARCH_CATALOG=main
VECTOR_SEARCH_SCHEMA=support
VECTOR_SEARCH_INDEX=support_docs_index
```

**Capabilities**: Look up customer history, search support docs, provide contextual help

### Example 3: Code Assistant Agent

```bash
# .env
VECTOR_SEARCH_CATALOG=main
VECTOR_SEARCH_SCHEMA=engineering
VECTOR_SEARCH_INDEX=code_docs_index
UC_FUNCTION_CATALOG=main
UC_FUNCTION_SCHEMA=engineering
UC_FUNCTION_NAME=analyze_code
```

**Capabilities**: Search code documentation, analyze code snippets, suggest improvements

## Next Steps

1. **Identify use case**: What should your agent help with?
2. **Choose tools**: Which MCP tools match your use case?
3. **Configure locally**: Update `.env` and test with `npm run dev:agent`
4. **Grant permissions**: Update `databricks.yml` with required resources
5. **Deploy**: `databricks bundle deploy && databricks bundle run agent_langchain_ts`
6. **Monitor**: Check MLflow traces and app logs
7. **Iterate**: Refine system prompt and tool selection based on usage

## Resources

- [Databricks MCP Documentation](https://docs.databricks.com/en/generative-ai/agent-framework/mcp/)
- [LangChain MCP Adapters](https://js.langchain.com/docs/integrations/tools/mcp)
- [Unity Catalog Functions](https://docs.databricks.com/en/sql/language-manual/sql-ref-functions-udf.html)
- [Vector Search Indexes](https://docs.databricks.com/en/generative-ai/vector-search.html)
- [Genie Spaces](https://docs.databricks.com/en/genie/)
