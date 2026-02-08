# MCP Tools Integration - Summary

This document summarizes the MCP (Model Context Protocol) tool integration added to the TypeScript agent template.

## What Was Added

### 1. Comprehensive Documentation

- **docs/ADDING_TOOLS.md** (400+ lines)
  - Complete guide for adding Databricks MCP tools
  - Configuration examples for all four tool types
  - Testing procedures and troubleshooting
  - Use-case specific examples (Data Analyst, Customer Support, RAG)

- **docs/README.md**
  - Central documentation index
  - Quick navigation to all docs
  - Common workflows and commands

### 2. Example Configurations

- **.env.mcp-example**
  - Pre-configured examples for common use cases
  - Comments explaining each tool type
  - Commands to discover Databricks resources

- **databricks.mcp-example.yml**
  - Permission patterns for all MCP tool types
  - Use-case specific configurations
  - Detailed comments explaining resource types

### 3. Test Suite

- **tests/mcp-tools.test.ts**
  - 15 test cases covering all MCP tool types
  - Tests skip automatically if tools not configured
  - Integration tests for multi-tool scenarios
  - Error handling verification

### 4. Updated Documentation

- **AGENTS.md** - Added MCP tools section to common tasks
- **CLAUDE.md** - Added MCP tools reference for AI agents
- **package.json** - Added `npm run test:mcp` script

## Four MCP Tool Types

### 1. Databricks SQL
**Purpose**: Direct SQL queries on Unity Catalog tables

**Configuration**:
```bash
ENABLE_SQL_MCP=true
```

**Use Cases**: Business intelligence, reporting, data exploration

### 2. Unity Catalog Functions
**Purpose**: Call UC functions as agent tools

**Configuration**:
```bash
UC_FUNCTION_CATALOG=main
UC_FUNCTION_SCHEMA=default
UC_FUNCTION_NAME=get_customer_info
```

**Use Cases**: Custom business logic, data transformations, complex queries

### 3. Vector Search
**Purpose**: Semantic search for RAG applications

**Configuration**:
```bash
VECTOR_SEARCH_CATALOG=main
VECTOR_SEARCH_SCHEMA=default
VECTOR_SEARCH_INDEX=product_docs_index
```

**Use Cases**: Q&A over documents, knowledge base queries, semantic search

### 4. Genie Spaces
**Purpose**: Natural language data queries

**Configuration**:
```bash
GENIE_SPACE_ID=01234567-89ab-cdef-0123-456789abcdef
```

**Use Cases**: Non-technical users querying data, exploratory analysis

## Quick Start Guide

### 1. Enable Tools

Edit `.env`:
```bash
# Example: Enable SQL MCP
ENABLE_SQL_MCP=true
```

### 2. Grant Permissions

Edit `databricks.yml`:
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

### 3. Test Locally

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

### 4. Deploy

```bash
npm run build
databricks bundle deploy
databricks bundle run agent_langchain_ts
```

## Example Use Cases

### Data Analyst Agent
```bash
# .env
ENABLE_SQL_MCP=true
GENIE_SPACE_ID=your-genie-space-id
```

**Capabilities**: Query sales data, generate reports, answer business questions

### Customer Support Agent
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

### RAG Documentation Agent
```bash
# .env
VECTOR_SEARCH_CATALOG=main
VECTOR_SEARCH_SCHEMA=docs
VECTOR_SEARCH_INDEX=product_documentation_index
```

**Capabilities**: Answer questions from documentation, find relevant articles

## Testing

### Run MCP Tool Tests
```bash
npm run test:mcp
```

Tests will automatically skip if MCP tools are not configured.

### Run All Tests
```bash
npm run test:all
```

## Key Architecture Points

1. **MCP tools are optional** - Agent works with just basic tools
2. **Fail gracefully** - If MCP setup fails, agent continues with basic tools
3. **Databricks-authenticated** - Uses same auth as model serving
4. **Configurable per-deployment** - Different tools for dev/prod via .env

## Files Reference

| File | Purpose |
|------|---------|
| `src/tools.ts` | MCP tool loading logic (already implemented) |
| `src/agent.ts` | Agent configuration with MCP support (already implemented) |
| `docs/ADDING_TOOLS.md` | Complete MCP tools guide (NEW) |
| `.env.mcp-example` | Configuration examples (NEW) |
| `databricks.mcp-example.yml` | Permission examples (NEW) |
| `tests/mcp-tools.test.ts` | MCP tool tests (NEW) |

## Common Troubleshooting

### "Permission denied" errors
**Solution**: Check `databricks.yml` has all required resource permissions

### "MCP server not responding"
**Solution**: Verify resource exists using Databricks CLI:
```bash
databricks api /api/2.0/unity-catalog/functions/main.default.my_function
```

### "Tool not found in agent"
**Solution**: Verify `.env` configuration and restart server

## Resources

- [Databricks MCP Documentation](https://docs.databricks.com/en/generative-ai/agent-framework/mcp/)
- [LangChain MCP Adapters](https://js.langchain.com/docs/integrations/tools/mcp)
- [Complete guide: docs/ADDING_TOOLS.md](docs/ADDING_TOOLS.md)

## Next Steps

1. Choose a use case (Data Analyst, Customer Support, RAG, etc.)
2. Configure tools in `.env` (use `.env.mcp-example` as reference)
3. Grant permissions in `databricks.yml` (use `databricks.mcp-example.yml` as reference)
4. Test locally with `npm run dev:agent`
5. Deploy with `databricks bundle deploy`

---

**Implementation Status**: ✅ Complete
**Documentation Status**: ✅ Complete
**Testing Status**: ✅ Complete (15 test cases)
**Example Configurations**: ✅ Complete (4 use cases)
