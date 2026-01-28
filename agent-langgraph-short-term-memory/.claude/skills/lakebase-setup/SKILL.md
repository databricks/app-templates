---
name: lakebase-setup
description: "Configure Lakebase for agent memory storage. Use when: (1) First-time memory setup, (2) 'Failed to connect to Lakebase' errors, (3) Permission errors on checkpoint tables, (4) User says 'lakebase', 'memory setup', or 'checkpoint'."
---

# Lakebase Setup for Memory

This template uses Lakebase (Databricks-managed PostgreSQL) to store conversation memory. You must configure Lakebase before the agent can persist state.

## Prerequisites

- A Lakebase instance in your Databricks workspace
- The instance name (found in Databricks UI under SQL Warehouses > Lakebase)

## Local Development Setup

**Step 1:** Add the Lakebase instance name to `.env.local`:

```bash
LAKEBASE_INSTANCE_NAME=<your-lakebase-instance-name>
```

**Step 2:** Run `uv run start-app` to test locally. The agent will automatically create checkpoint tables on first run.

## Deployed App Setup

After deploying your agent with `databricks bundle deploy`, you must grant the app's service principal access to Lakebase.

### Step 1: Add Lakebase as App Resource

1. Go to the Databricks UI
2. Navigate to your app and click **Edit**
3. Go to **App resources** → **Add resource**
4. Add your Lakebase instance with **Connect + Create** permissions

### Step 2: Get App Service Principal ID

```bash
databricks apps get <your-app-name> --output json | jq -r '.service_principal_id'
```

### Step 3: Grant Permissions

Choose **Option A** (SDK - Recommended) or **Option B** (SQL).

#### Option A: Using LakebaseClient SDK (Recommended)

The `databricks-ai-bridge` package includes a `LakebaseClient` for programmatic permission management:

```python
from databricks_ai_bridge.lakebase import LakebaseClient, SchemaPrivilege, TablePrivilege

# Initialize client
client = LakebaseClient(instance_name="<your-lakebase-instance>")

app_sp = "<app-service-principal-id>"  # From Step 2

# Create role for the service principal
client.create_role(app_sp, "SERVICE_PRINCIPAL")

# Grant schema privileges
client.grant_schema(
    grantee=app_sp,
    privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
    schemas=["drizzle", "ai_chatbot", "public"],
)

# Grant table privileges on all tables in schemas
client.grant_all_tables_in_schema(
    grantee=app_sp,
    privileges=[TablePrivilege.SELECT, TablePrivilege.INSERT, TablePrivilege.UPDATE],
    schemas=["drizzle", "ai_chatbot"],
)

# Grant privileges on specific checkpoint tables
client.grant_table(
    grantee=app_sp,
    privileges=[TablePrivilege.SELECT, TablePrivilege.INSERT, TablePrivilege.UPDATE],
    tables=[
        "public.checkpoint_migrations",
        "public.checkpoint_writes",
        "public.checkpoints",
        "public.checkpoint_blobs",
    ],
)
```

**Benefits of SDK approach:**
- Type-safe privilege enums prevent typos
- Cleaner Python code vs raw SQL
- Easier to integrate into setup scripts

#### Option B: Using SQL

Run the following SQL on your Lakebase instance (replace `app-sp-id` with your app's service principal ID):

```sql
DO $$
DECLARE
   app_sp text := 'app-sp-id';  -- TODO: Replace with your App's Service Principal ID
BEGIN
   -------------------------------------------------------------------
   -- Drizzle schema: migration metadata tables
   -------------------------------------------------------------------
   EXECUTE format('GRANT USAGE, CREATE ON SCHEMA drizzle TO %I;', app_sp);
   EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA drizzle TO %I;', app_sp);
   -------------------------------------------------------------------
   -- App schema: business tables (Chat, Message, etc.)
   -------------------------------------------------------------------
   EXECUTE format('GRANT USAGE, CREATE ON SCHEMA ai_chatbot TO %I;', app_sp);
   EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ai_chatbot TO %I;', app_sp);
   -------------------------------------------------------------------
   -- Public schema for checkpoint tables
   -------------------------------------------------------------------
   EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I;', app_sp);
   EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.checkpoint_migrations TO %I;', app_sp);
   EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.checkpoint_writes TO %I;',       app_sp);
   EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.checkpoints TO %I;',             app_sp);
   EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.checkpoint_blobs TO %I;',        app_sp);
END $$;
```

**Schema Reference:**
| Schema | Purpose |
|--------|---------|
| `drizzle` | Migration metadata tables |
| `ai_chatbot` | Business tables (Chat, Message, etc.) |
| `public` | Checkpoint tables for conversation state |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **"LAKEBASE_INSTANCE_NAME environment variable is required"** | Add `LAKEBASE_INSTANCE_NAME=<name>` to `.env.local` |
| **"Failed to connect to Lakebase instance"** | Verify instance name is correct and your profile has access |
| **Permission errors on checkpoint tables** | Run the SDK script or SQL grant commands above |
| **Deployed app can't access Lakebase** | Add Lakebase as app resource in Databricks UI |
| **"role does not exist"** | Run `client.create_role()` first, or ensure SP ID is correct |

### Common Error Messages

**Local development:**
```
Failed to connect to Lakebase instance '<name>'. Please verify:
1. The instance name is correct
2. You have the necessary permissions to access the instance
3. Your Databricks authentication is configured correctly
```

**Deployed app:**
```
Failed to connect to Lakebase instance '<name>'. The App Service Principal for '<app-name>' may not have access.
```

Both errors indicate Lakebase access issues. Follow the setup steps above for your environment.

## How Memory Works

See the **agent-memory** skill for:
- How `AsyncCheckpointSaver` persists conversation state
- Using `thread_id` to maintain conversation context
- API request examples with thread_id

## Next Steps

- Understand memory patterns: see **agent-memory** skill
- Test locally: see **run-locally** skill
- Deploy: see **deploy** skill
