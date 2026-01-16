# Agent Development Guide

## For AI Agents: MANDATORY First Action

**BEFORE any other action, run `databricks auth profiles` to check authentication status.**

This helps you understand:
- Which Databricks profiles are configured
- Whether authentication is already set up
- Which profile to use for subsequent commands

If no profiles exist, guide the user through running `./scripts/quickstart.sh` to set up authentication.

## For AI Agents: Handling Deployment Errors

**If `databricks bundle deploy` fails with "An app with the same name already exists":**

Ask the user: "I see there's an existing app with the same name. Would you like me to bind it to this bundle so we can manage it, or delete it and create a new one?"

- **If they want to bind**: Follow the steps in the "Binding an existing app to your bundle" section
- **If they want to delete**: Run `databricks apps delete <app-name>` then deploy again

---

## Getting Started with Your Agent

This guide walks you through the initial setup of your agent project: installing prerequisites, discovering available tools in your workspace, and testing the baseline template locally.

**After completing these steps**, see the README.md for information on modifying your agent and deploying to Databricks.

---

## Quick Setup

**Prerequisites:** uv, nvm (Node 20), Databricks CLI (v0.283.0+)

**What you need:**
- uv (Python package manager)
- nvm (Node.js version manager) with Node 20
- Databricks CLI v0.283.0 or above

**Quickest path to running:**

```bash
# 0. Ensure you have the latest Databricks CLI
databricks -v  # Should be v0.283.0 or above
brew upgrade databricks # Offer to run if the Databricks CLI version is too old 

# 1. Initialize git (recommended for version control)
git init

# 2. Run quickstart for setup (auth, MLflow experiment)
./scripts/quickstart.sh

# Or run non-interactively with a profile
./scripts/quickstart.sh --profile DEFAULT

# Or with a host URL for initial setup
./scripts/quickstart.sh --host https://your-workspace.cloud.databricks.com

# 3. Discover available tools (IMPORTANT - do this before coding!)
uv run discover-tools

# 4. Start the agent server
uv run start-app
```

**Quickstart script handles:**
- Databricks authentication (OAuth)
- MLflow experiment creation
- Environment variable configuration (`.env.local`)

**Quickstart options:**
- `--profile NAME`: Use specified Databricks profile (non-interactive)
- `--host URL`: Databricks workspace URL (for initial setup)
- `-h, --help`: Show help message

---

## Discovering Available Tools

**⚠️ CRITICAL:** Always run tool discovery BEFORE writing agent code!

This step helps you understand what resources are already available in your workspace, preventing duplicate work and showing you the best practices for connecting to each resource.

```bash
# Discover all available resources (recommended)
uv run discover-tools

# Use a specific Databricks CLI profile
uv run discover-tools --profile my-profile

# Limit to specific catalog/schema
uv run discover-tools --catalog my_catalog --schema my_schema

# Customize search depth for faster execution
uv run discover-tools --max-results 50 --max-schemas 10

# Deep search for more comprehensive discovery (slower, but finds more)
uv run discover-tools --max-results 500 --max-schemas 100

# Output as JSON for programmatic use
uv run discover-tools --format json --output tools.json

# Save markdown report
uv run discover-tools --output tools.md
```

**What gets discovered:**
1. **Unity Catalog Functions** - SQL UDFs usable as agent tools
2. **Unity Catalog Tables** - Structured data for querying
3. **Vector Search Indexes** - For RAG applications
4. **Genie Spaces** - Natural language interface to data
5. **Custom MCP Servers** - Your MCP servers deployed as Databricks Apps
6. **External MCP Servers** - Third-party MCP servers via UC connections

**Using discovered tools in your agent:**

After discovering tools, configure your agent to use them:

```python
from databricks_openai.agents import McpServer

async def init_mcp_server():
    return McpServer(
        url=f"{host}/api/2.0/mcp/functions/{catalog}/{schema}",
        name="my custom tools",
    )

# Use in agent
agent = Agent(
    name="my agent",
    instructions="You are a helpful agent.",
    model="databricks-claude-3-7-sonnet",
    mcp_servers=[mcp_server],
)
```

See the [MCP documentation](https://docs.databricks.com/aws/en/generative-ai/mcp/) for more details.

---

## Running the App Locally

**Start the server:**

```bash
uv run start-app
```

This starts the agent at http://localhost:8000

**Advanced server options:**

```bash
uv run start-server --reload   # Hot-reload on code changes during development
uv run start-server --port 8001
uv run start-server --workers 4
```

**Test the API:**

```bash
# Streaming request
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'

# Non-streaming request
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }] }'
```

**Common issues:**
- Port already in use: Use `--port` to specify a different port
- Authentication errors: Verify `.env.local` is correct
- Module not found: Run `uv sync` to install dependencies

---

## Modifying the Agent

**Main file to modify:** `agent_server/agent.py`

**Key resources:**
1. [databricks-openai SDK](https://github.com/databricks/databricks-ai-bridge/tree/main/integrations/openai)
2. [Agent examples](https://github.com/bbqiu/agent-on-app-prototype)
3. [Agent Framework docs](https://docs.databricks.com/aws/en/generative-ai/agent-framework/)
4. [Adding tools](https://docs.databricks.com/aws/en/generative-ai/agent-framework/agent-tool)
5. [OpenAI Agents SDK](https://platform.openai.com/docs/guides/agents-sdk)
6. [Responses API](https://mlflow.org/docs/latest/genai/serving/responses-agent/)

**databricks-openai SDK basics:**

```python
from databricks_openai import AsyncDatabricksOpenAI
from agents import set_default_openai_api, set_default_openai_client

# Set up async client (recommended for agent servers)
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")
```

---

## Testing the Agent

```bash
# Run evaluation
uv run agent-evaluate

# Run unit tests
pytest [path]
```

**Test API locally:**

```bash
# Streaming request
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'

# Non-streaming request
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }] }'
```

---

## Deploying to Databricks Apps

**Deploy using Databricks bundles:**

```bash
# Deploy the bundle (creates/updates resources and uploads files)
databricks bundle deploy

# Run the app (starts/restarts the app with uploaded source code)
databricks bundle run agent_openai_agents_sdk
```

The resource key `agent_openai_agents_sdk` matches the app name defined in `databricks.yml` under `resources.apps.agent_openai_agents_sdk`.

**Error: "An app with the same name already exists"**

If you see this error when running `databricks bundle deploy`:

```
Error: failed to create app

Failed to create app <app-name>. An app with the same name already exists.
```

This means you have an existing app that needs to be linked to your bundle. You have two options:

1. **Bind the existing app to your bundle** (recommended if you want to manage the existing app):
   - Follow the steps in [Binding an existing app to your bundle](#binding-an-existing-app-to-your-bundle) below
   - This will link the existing app to your bundle so future deploys update it

2. **Delete the existing app and let the bundle create a new one**:
   ```bash
   databricks apps delete <app-name>
   databricks bundle deploy
   ```
   - ⚠️ This will permanently delete the existing app including its URL, OAuth credentials, and service principal

**Binding an existing app to your bundle:**

If you've already deployed an app from a different directory or through the UI and want to link it to this bundle, follow these steps:

**Step 1: Update `databricks.yml` to match the existing app name**

⚠️ **CRITICAL**: The app name in your `databricks.yml` **must match** the existing app name exactly, or Terraform will **destroy and recreate** the app (not update it in-place).

First, find your existing app name:
```bash
# List existing apps to find the app name
databricks apps list --output json | jq '.[].name'
```

Then update `databricks.yml` to use that exact name:
```yaml
resources:
  apps:
    agent_openai_agents_sdk:
      name: "openai-agents-sdk-agent"  # Match your existing app name exactly
      description: "OpenAI Agents SDK agent application"
      source_code_path: ./
```

The default configuration uses:
```yaml
name: "${bundle.target}-agent-openai-agents-sdk"  # Evaluates to "dev-agent-openai-agents-sdk"
```

Make sure to replace this with your actual app name.

**Step 2: Bind the resource to the existing app**

```bash
# Bind the resource to the existing app
databricks bundle deployment bind agent_openai_agents_sdk <existing-app-name>

# Example:
databricks bundle deployment bind agent_openai_agents_sdk openai-agents-sdk-agent

# If the operation requires confirmation and you want to skip prompts:
databricks bundle deployment bind agent_openai_agents_sdk openai-agents-sdk-agent --auto-approve
```

This links your bundle configuration to the existing deployed app. Future `databricks bundle deploy` commands will update the existing app instead of creating a new one.

**Important notes about binding:**
- **Remote Terraform state**: Databricks stores Terraform state remotely, so the same app can be detected across different local directories
- **Name is immutable**: The `name` field cannot be changed in-place; changing it forces replacement (destroy + create)
- **Review the plan**: When binding, carefully review the Terraform plan output. Look for `# forces replacement` which indicates the app will be destroyed and recreated
- **Existing binding**: If a resource is already bound to another app, you must unbind it first before binding to a different app

**Unbinding a resource:**

To remove the link between your bundle and the deployed app:

```bash
databricks bundle deployment unbind agent_openai_agents_sdk
```

This is useful when:
- You want to bind to a different app
- You want to let the bundle create a new app on the next deploy
- You're switching between different deployed instances

Note: Unbinding only removes the link in your bundle state - it does not delete the deployed app.

**Query deployed app:**

Generate OAuth token (PATs are not supported):

```bash
databricks auth token
```

Send request:

```bash
curl -X POST <app-url>/invocations \
  -H "Authorization: Bearer <oauth-token>" \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
```

**Debug deployed apps:**

```bash
# View logs (use the deployed app name from databricks.yml)
databricks apps logs dev-agent-openai-agents-sdk --follow

# Check status
databricks apps get dev-agent-openai-agents-sdk --output json | jq '{app_status, compute_status}'
```

---

## Key Files

| File                             | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `agent_server/agent.py`          | Agent logic, model, instructions, MCP servers |
| `agent_server/start_server.py`   | FastAPI server + MLflow setup                 |
| `agent_server/evaluate_agent.py` | Agent evaluation with MLflow scorers          |
| `agent_server/utils.py`          | Databricks auth helpers, stream processing    |
| `scripts/start_app.py`           | Manages backend+frontend startup              |
| `scripts/discover_tools.py`      | Discovers available workspace resources       |
| `scripts/quickstart.sh`          | One-command setup script                      |

---

## Agent Framework Capabilities

**Tool Types:**
1. **Unity Catalog Function Tools** - SQL UDFs managed in UC with built-in governance
2. **Agent Code Tools** - Defined directly in agent code for REST APIs and low-latency operations
3. **MCP Tools** - Interoperable tools via Model Context Protocol (Databricks-managed, external, or self-hosted)

**Built-in Tools:**
- **system.ai.python_exec** - Execute Python code dynamically within agent queries (code interpreter)

**Common Patterns:**
- **Structured data retrieval** - Query SQL tables/databases
- **Unstructured data retrieval** - Document search and RAG via Vector Search
- **Code interpreter** - Python execution for analysis via system.ai.python_exec
- **External connections** - Integrate services like Slack via HTTP connections

Reference: https://docs.databricks.com/aws/en/generative-ai/agent-framework/

---

## Next Steps

✅ **You've completed the initial setup!**

After running the quickstart script, you have:
- ✅ Installed prerequisites
- ✅ Authenticated with Databricks
- ✅ Created MLflow experiment
- ✅ Discovered available tools in your workspace

Now you're ready to:
- Start the agent locally: `uv run start-app`
- Modify your agent to use the tools you discovered
- Deploy your agent to Databricks

**See the README.md** for more information on:
- Modifying the agent and adding tools
- Evaluating your agent
- Deploying to Databricks Apps
- Debugging and monitoring deployed apps
