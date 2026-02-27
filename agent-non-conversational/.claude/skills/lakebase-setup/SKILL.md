---
name: lakebase-setup
description: "Configure Lakebase for agent memory storage. Use when: (1) Adding memory capabilities to the agent, (2) 'Failed to connect to Lakebase' errors, (3) Permission errors on checkpoint/store tables, (4) User says 'lakebase', 'memory setup', or 'add memory'."
---

# Lakebase Setup for Agent Memory

> **Note:** This template does not include memory by default. Use this skill if you want to **add memory capabilities** to your agent. For pre-configured memory templates, see:
> - `agent-langgraph-short-term-memory` - Conversation history within a session
> - `agent-langgraph-long-term-memory` - User facts that persist across sessions

## Overview

Lakebase provides persistent storage for agent memory:
- **Short-term memory**: Conversation history within a thread (`AsyncCheckpointSaver`)
- **Long-term memory**: User facts across sessions (`AsyncDatabricksStore`)

## Complete Setup Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Add dependency  →  2. Get instance  →  3. Configure DAB               │
│  4. Configure .env  →  5. Initialize tables  →  6. Deploy + Run      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Add Memory Dependency

Add the memory extra to your `pyproject.toml`:

```toml
dependencies = [
    "databricks-langchain[memory]",
    # ... other dependencies
]
```

Then sync dependencies:
```bash
uv sync
```

---

## Step 2: Create or Get Lakebase Instance

### Option A: Create New Instance (via Databricks UI)

1. Go to your Databricks workspace
2. Navigate to **Compute** → **Lakebase**
3. Click **Create Instance**
4. Note the instance name

### Option B: Use Existing Instance

If you have an existing instance, note its name for the next step.

---

## Step 3: Configure databricks.yml (Lakebase Resource)

Add the Lakebase `database` resource to your app in `databricks.yml`:

```yaml
resources:
  apps:
    agent_langgraph:
      name: "your-app-name"
      source_code_path: ./

      resources:
        # ... other resources (experiment, UC functions, etc.) ...

        # Lakebase instance for long-term memory
        - name: 'database'
          database:
            instance_name: '<your-lakebase-instance-name>'
            database_name: 'postgres'
            permission: 'CAN_CONNECT_AND_CREATE'
```

**Important:**
- The `instance_name: '<your-lakebase-instance-name>'` must match the actual Lakebase instance name
- Using the `database` resource type automatically grants the app's service principal access to Lakebase

### Add Environment Variables to databricks.yml config block

Add the Lakebase environment variables to the `config.env` section of your app in `databricks.yml`:

```yaml
      config:
        command: ["uv", "run", "start-app"]
        env:
          # ... other env vars ...

          # Lakebase instance name - resolved from database resource at deploy time
          - name: LAKEBASE_INSTANCE_NAME
            valueFrom: "database"

          # Static values for embedding configuration
          - name: EMBEDDING_ENDPOINT
            value: "databricks-gte-large-en"
          - name: EMBEDDING_DIMS
            value: "1024"
```

**Important:**
- The `LAKEBASE_INSTANCE_NAME` uses `valueFrom: "database"` which resolves from the `database` resource at deploy time
- The `database` resource handles permissions; the `config.env` provides the instance name to your code

---

## Step 4: Configure .env (Local Development)

For local development, add to `.env`:

```bash
# Lakebase configuration for long-term memory
LAKEBASE_INSTANCE_NAME=<your-instance-name>
EMBEDDING_ENDPOINT=databricks-gte-large-en
EMBEDDING_DIMS=1024
```

**Important:** `embedding_dims` must match the embedding endpoint:

| Endpoint | Dimensions |
|----------|------------|
| `databricks-gte-large-en` | 1024 |
| `databricks-bge-large-en` | 1024 |

> **Note:** `.env` is only for local development. When deployed, the app gets `LAKEBASE_INSTANCE_NAME` from the `valueFrom` reference in the `databricks.yml` config block.

---

## Step 5: Initialize Store Tables (CRITICAL - First Time Only)

**Before deploying**, you must initialize the Lakebase tables. The `AsyncDatabricksStore` creates tables on first use, but you need to do this locally first:

```python
# Run this script locally BEFORE first deployment
import asyncio
from databricks_langchain import AsyncDatabricksStore

async def setup_store():
    async with AsyncDatabricksStore(
        instance_name="<your-instance-name>",
        embedding_endpoint="databricks-gte-large-en",
        embedding_dims=1024,
    ) as store:
        print("Setting up store tables...")
        await store.setup()  # Creates required tables
        print("Store tables created!")

        # Verify with a test write/read
        await store.aput(("test", "init"), "test_key", {"value": "test_value"})
        results = await store.asearch(("test", "init"), query="test", limit=1)
        print(f"Test successful: {results}")

asyncio.run(setup_store())
```

Run with:
```bash
uv run python -c "$(cat <<'EOF'
import asyncio
from databricks_langchain import AsyncDatabricksStore

async def setup():
    async with AsyncDatabricksStore(
        instance_name="<your-instance-name>",
        embedding_endpoint="databricks-gte-large-en",
        embedding_dims=1024,
    ) as store:
        await store.setup()
        print("Tables created!")

asyncio.run(setup())
EOF
)"
```

This creates these tables in the `public` schema:
- `store` - Key-value storage for memories
- `store_vectors` - Vector embeddings for semantic search
- `store_migrations` - Schema migration tracking
- `vector_migrations` - Vector schema migration tracking

---

## Step 6: Deploy and Run Your App

**IMPORTANT:** Always run both `deploy` AND `run` commands:

```bash
# Deploy resources and upload files
databricks bundle deploy

# Start/restart the app with new code (REQUIRED!)
databricks bundle run agent_langgraph
```

> **Note:** `bundle deploy` only uploads files and configures resources. `bundle run` is required to actually start the app with the new code.

---

## Complete Example: databricks.yml with Lakebase

```yaml
bundle:
  name: agent_langgraph

resources:
  experiments:
    agent_langgraph_experiment:
      name: /Users/${workspace.current_user.userName}/${bundle.name}-${bundle.target}

  apps:
    agent_langgraph:
      name: "my-agent-app"
      description: "Agent with long-term memory"
      source_code_path: ./
      config:
        command: ["uv", "run", "start-app"]
        env:
          - name: MLFLOW_TRACKING_URI
            value: "databricks"
          - name: MLFLOW_REGISTRY_URI
            value: "databricks-uc"
          - name: API_PROXY
            value: "http://localhost:8000/invocations"
          - name: CHAT_APP_PORT
            value: "3000"
          - name: CHAT_PROXY_TIMEOUT_SECONDS
            value: "300"
          # Reference experiment resource
          - name: MLFLOW_EXPERIMENT_ID
            valueFrom: "experiment"
          # Lakebase instance name (resolved from database resource)
          - name: LAKEBASE_INSTANCE_NAME
            valueFrom: "database"
          # Embedding configuration
          - name: EMBEDDING_ENDPOINT
            value: "databricks-gte-large-en"
          - name: EMBEDDING_DIMS
            value: "1024"

      resources:
        - name: 'experiment'
          experiment:
            experiment_id: "${resources.experiments.agent_langgraph_experiment.id}"
            permission: 'CAN_MANAGE'

        # Lakebase instance for long-term memory
        - name: 'database'
          database:
            instance_name: '<your-lakebase-instance-name>'
            database_name: 'postgres'
            permission: 'CAN_CONNECT_AND_CREATE'

targets:
  dev:
    mode: development
    default: true
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| **"embedding_dims is required when embedding_endpoint is specified"** | Missing `embedding_dims` parameter | Add `embedding_dims=1024` to AsyncDatabricksStore |
| **"relation 'store' does not exist"** | Tables not initialized | Run `await store.setup()` locally first (Step 5) |
| **"Unable to resolve Lakebase instance 'None'"** | Missing env var in deployed app | Add `LAKEBASE_INSTANCE_NAME` to databricks.yml `config.env` |
| **"Unable to resolve Lakebase instance '...database.cloud.databricks.com'"** | Used valueFrom instead of value | Use `value: "<instance-name>"` not `valueFrom` for Lakebase |
| **"permission denied for table store"** | Missing grants | The `database` resource in DAB should handle this; verify the resource is configured |
| **"Failed to connect to Lakebase"** | Wrong instance name | Verify instance name in databricks.yml and .env |
| **Connection pool errors on exit** | Python cleanup race | Ignore `PythonFinalizationError` - it's harmless |
| **App not updated after deploy** | Forgot to run bundle | Run `databricks bundle run agent_langgraph` after deploy |
| **valueFrom not resolving** | Resource name mismatch | Ensure `valueFrom` value matches `name` in databricks.yml resources |

---

## Quick Reference: LakebaseClient API

For manual permission management (usually not needed with DAB `database` resource):

```python
from databricks_ai_bridge.lakebase import LakebaseClient, SchemaPrivilege, TablePrivilege

client = LakebaseClient(instance_name="...")

# Create role (must do first)
client.create_role(identity_name, "SERVICE_PRINCIPAL")

# Grant schema (note: schemas is a list, grantee not role)
client.grant_schema(
    grantee="...",
    schemas=["public"],
    privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
)

# Grant tables (note: tables includes schema prefix)
client.grant_table(
    grantee="...",
    tables=["public.store"],
    privileges=[TablePrivilege.SELECT, TablePrivilege.INSERT, ...],
)

# Execute raw SQL
client.execute("SELECT * FROM pg_tables WHERE schemaname = 'public'")
```

### Service Principal Identifiers

When granting permissions manually, note that Databricks apps have multiple identifiers:

| Field | Format | Example |
|-------|--------|---------|
| `service_principal_id` | Numeric ID | `1234567890123456` |
| `service_principal_client_id` | UUID | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| `service_principal_name` | String name | `my-app-service-principal` |

**Get all identifiers:**
```bash
databricks apps get <app-name> --output json | jq '{
  id: .service_principal_id,
  client_id: .service_principal_client_id,
  name: .service_principal_name
}'
```

**Which to use:**
- `LakebaseClient.create_role()` - Use `service_principal_client_id` (UUID) or `service_principal_name`
- Raw SQL grants - Use `service_principal_client_id` (UUID)

---

## Next Steps

- Add memory to agent code: see **agent-memory** skill
- Test locally: see **run-locally** skill
- Deploy: see **deploy** skill
