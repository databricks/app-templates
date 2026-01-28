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

## Step 1: Add Memory Dependency

Add the memory extra to your `pyproject.toml`:

```toml
dependencies = [
    "databricks-langchain[memory]>=0.13.0",
    # ... other dependencies
]
```

Then sync dependencies:
```bash
uv sync
```

## Step 2: Configure Lakebase Instance

Add to your `.env`:
```bash
LAKEBASE_INSTANCE_NAME="<your-lakebase-instance>"
```

The quickstart script can help you find or create a Lakebase instance.

## Step 3: Grant Permissions (After Deployment)

After deploying your app, grant the app's service principal access to Lakebase.

### Option A: Using LakebaseClient SDK (Recommended)

```python
from databricks_ai_bridge.lakebase import LakebaseClient, SchemaPrivilege, TablePrivilege

# Initialize client
client = LakebaseClient(instance_name="<your-lakebase-instance>")

# Get app service principal from: databricks apps get <app-name>
app_sp = "<app-service-principal-id>"

# Create role for the service principal
client.create_role(app_sp, "SERVICE_PRINCIPAL")

# Grant schema privileges
client.grant_schema(
    role=app_sp,
    schema="public",
    privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
)

# Grant table privileges (for existing tables)
client.grant_all_tables_in_schema(
    role=app_sp,
    schema="public",
    privileges=[TablePrivilege.SELECT, TablePrivilege.INSERT, TablePrivilege.UPDATE, TablePrivilege.DELETE],
)
```

### Option B: Using SQL

Connect to your Lakebase instance via SQL and run:

```sql
-- Replace <app-service-principal-id> with your app's service principal
-- Get it from: databricks apps get <app-name> --output json | jq -r '.service_principal_id'

-- Grant schema access
GRANT USAGE, CREATE ON SCHEMA public TO "<app-service-principal-id>";

-- Grant table access for memory tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "<app-service-principal-id>";
```

## Adding Memory to Your Agent

See the **agent-memory** skill for code patterns to add:
- Short-term memory (conversation history)
- Long-term memory (persistent user facts)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **"Failed to connect to Lakebase"** | Verify `LAKEBASE_INSTANCE_NAME` in `.env` |
| **Permission denied on tables** | Run the SQL grants above after deployment |
| **"Role does not exist"** | Use the service principal ID, not name |
| **Tables not created** | Tables are created automatically on first use |

## Next Steps

- Add memory patterns: see **agent-memory** skill
- Test locally: see **run-locally** skill
- Deploy: see **deploy** skill
