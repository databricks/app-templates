# TypeScript Agent Documentation

Complete documentation for developing LangChain agents on Databricks.

## 📚 Documentation Index

### Getting Started

- **[AGENTS.md](../AGENTS.md)** - Main user guide for developing TypeScript agents
  - Quick start and setup
  - Development workflow
  - Testing procedures
  - Deployment guide
  - Common tasks and troubleshooting

- **[CLAUDE.md](../CLAUDE.md)** - Agent-facing development guide
  - Quick reference for AI assistants
  - Common commands and patterns
  - Key files and their purposes

### Advanced Topics

- **[ADDING_TOOLS.md](ADDING_TOOLS.md)** - Complete guide for adding Databricks MCP tools
  - Databricks SQL for direct table queries
  - Unity Catalog Functions as agent tools
  - Vector Search for RAG applications
  - Genie Spaces for natural language data queries
  - Configuration examples and troubleshooting

### Examples

- **[.env.mcp-example](../.env.mcp-example)** - Example environment configurations
  - Data Analyst Agent
  - Customer Support Agent
  - RAG Documentation Agent
  - Full-stack agent with all tools

- **[databricks.mcp-example.yml](../databricks.mcp-example.yml)** - Example DAB configurations
  - Permission patterns for all MCP tool types
  - Use-case specific configurations
  - Resource discovery commands

### Architecture

- **[ARCHITECTURE_FINAL.md](../ARCHITECTURE_FINAL.md)** - System architecture documentation
  - Two-server design (agent + UI)
  - Agent-first architecture
  - Production deployment patterns

- **[REQUIREMENTS.md](../REQUIREMENTS.md)** - Technical requirements and specifications
  - Responses API format
  - SSE streaming protocol
  - Deployment constraints

## 🚀 Quick Navigation

| I want to... | Read this |
|--------------|-----------|
| Set up my first agent | [AGENTS.md - Quick Start](../AGENTS.md#quick-start) |
| Add database query tools | [ADDING_TOOLS.md - Databricks SQL](ADDING_TOOLS.md#databricks-sql-mcp) |
| Enable vector search (RAG) | [ADDING_TOOLS.md - Vector Search](ADDING_TOOLS.md#vector-search-rag) |
| Deploy to Databricks | [AGENTS.md - Deploy](../AGENTS.md#5-deploy-to-databricks) |
| Test deployed agent | [AGENTS.md - Test Deployed](../AGENTS.md#6-test-deployed-app) |
| Troubleshoot issues | [AGENTS.md - Troubleshooting](../AGENTS.md#troubleshooting) |
| Understand architecture | [ARCHITECTURE_FINAL.md](../ARCHITECTURE_FINAL.md) |
| Configure MCP tools | [ADDING_TOOLS.md](ADDING_TOOLS.md) |

## 🎯 Common Workflows

### First-Time Setup

1. Read [AGENTS.md - Prerequisites](../AGENTS.md#prerequisites)
2. Run `npm run quickstart`
3. Follow [AGENTS.md - Development Workflow](../AGENTS.md#development-workflow)

### Adding Databricks Tools

1. Read [ADDING_TOOLS.md - Overview](ADDING_TOOLS.md#overview)
2. Choose your tool type (SQL, UC Functions, Vector Search, Genie)
3. Follow [ADDING_TOOLS.md - Quick Start](ADDING_TOOLS.md#quick-start)
4. Test using [ADDING_TOOLS.md - Testing](ADDING_TOOLS.md#testing-mcp-tools)

### Local Development Loop

1. Start servers: `npm run dev`
2. Make changes to `src/agent.ts` or `src/tools.ts`
3. Test: `curl` to http://localhost:5001/invocations
4. Run tests: `npm run test:all`
5. Commit and deploy

### Deployment Workflow

1. Build: `npm run build`
2. Deploy: `databricks bundle deploy`
3. Run: `databricks bundle run agent_langchain_ts`
4. Check logs: `databricks apps logs agent-lc-ts-dev --follow`
5. Test: See [AGENTS.md - Test Deployed App](../AGENTS.md#6-test-deployed-app)

## 📖 Documentation for AI Agents

If you're an AI agent helping developers with this codebase:

1. **Start with**: [CLAUDE.md](../CLAUDE.md) for quick reference
2. **Check auth**: Always run `databricks auth profiles` first
3. **Use skills**: Reference `.claude/skills/` for specific tasks
4. **Reference**: Point users to [AGENTS.md](../AGENTS.md) for detailed instructions

## 🔧 Test Suites

| Test Suite | Command | Purpose |
|------------|---------|---------|
| Agent tests | `npm run test:unit` | Core agent functionality |
| Integration tests | `npm run test:integration` | Local endpoint tests |
| Error handling | `npm run test:error-handling` | Error scenarios |
| MCP tools | `npm run test:mcp` | Databricks MCP integration |
| Deployed tests | `npm run test:deployed` | Production deployment tests |
| All tests | `npm run test:all` | Complete test suite |

## 📝 Configuration Files

| File | Purpose |
|------|---------|
| `.env` | Local environment configuration |
| `.env.example` | Template with basic tools |
| `.env.mcp-example` | Template with MCP tools |
| `databricks.yml` | Deployment configuration |
| `databricks.mcp-example.yml` | MCP permissions examples |
| `app.yaml` | Databricks Apps settings |

## 🛠️ Key Source Files

| File | Purpose | Modify When |
|------|---------|-------------|
| `src/agent.ts` | Agent logic, prompts | Changing agent behavior |
| `src/tools.ts` | Tool definitions | Adding capabilities |
| `src/server.ts` | HTTP server | Changing routes/config |
| `src/routes/invocations.ts` | Responses API | Modifying streaming |
| `src/tracing.ts` | MLflow integration | Customizing observability |

## 🔍 Finding Resources

### Discover Available Databricks Resources

```bash
# List Genie Spaces
databricks api /api/2.0/genie/spaces/list | jq -r '.spaces[] | {name, space_id}'

# List Vector Search Indexes
databricks api /api/2.0/vector-search/indexes/list | jq -r '.vector_indexes[] | {name, index_name}'

# List UC Functions
databricks api /api/2.0/unity-catalog/functions/list?catalog_name=main&schema_name=default | jq -r '.functions[] | {name, full_name}'

# List UC Schemas
databricks api /api/2.0/unity-catalog/schemas/list?catalog_name=main | jq -r '.schemas[] | {name, full_name}'
```

## 📚 External Resources

- [LangChain.js Documentation](https://js.langchain.com/docs/)
- [Databricks AI SDK Provider](https://github.com/databricks/ai-sdk-provider)
- [Databricks MCP Documentation](https://docs.databricks.com/en/generative-ai/agent-framework/mcp/)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [MLflow Tracing](https://mlflow.org/docs/latest/llms/tracing/index.html)

## 🤝 Contributing

When adding new documentation:

1. Follow the existing structure
2. Include code examples
3. Add to this README index
4. Update relevant cross-references
5. Test all commands and examples

## 📄 License

Same as parent project.

---

**Last Updated**: 2026-02-08
**Template Version**: 1.0.0
