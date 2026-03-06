# Autoscaling Postgres Lakebase Instances (not provisioned)

Autoscaling Lakebase postgres resources are **not yet supported as resource dependencies in `databricks.yml`**. Use `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` as static env vars, and add the postgres resource via API after deploy for **permissions** only.

## Steps

### 1. Add autoscaling env vars to `databricks.yml`

Add `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` as static `value:` env vars in your app's config block:

```yaml
# In databricks.yml - add to resources.apps.<app>.config.env:
- name: LAKEBASE_AUTOSCALING_PROJECT
  value: "<your-project-name>"
- name: LAKEBASE_AUTOSCALING_BRANCH
  value: "<your-branch-name>"
```

### 2. Deploy your agent app

```bash
databricks bundle deploy
databricks bundle run <your-app-resource-name>  # from databricks.yml resources.apps.*
```

### 3. Add the postgres resource via API (for permissions only)

After the app is deployed, add the postgres resource using the Databricks API. This grants the app's service principal access to Lakebase — the app reads PROJECT+BRANCH from env vars, not from this resource.

**Important:** The PATCH replaces the entire `resources` list, so you must fetch existing resources first and append the postgres resource to preserve other resources (e.g., MLflow experiments added by DAB).

```bash
# 1. Fetch existing resources
EXISTING=$(databricks api get /api/2.0/apps/<your-app-name> | jq -c '.resources // []')

# 2. Append the postgres resource
UPDATED=$(echo "$EXISTING" | jq -c '. + [{
  "name": "postgres",
  "postgres": {
    "branch": "projects/<project-id>/branches/<branch-id>",
    "database": "projects/<project-id>/branches/<branch-id>/databases/<database-id>",
    "permission": "CAN_CONNECT_AND_CREATE"
  }
}]')

# 3. Patch with the merged list
databricks api patch /api/2.0/apps/<your-app-name> \
  --json "{\"resources\": $UPDATED}"
```

Replace the placeholders:
- `<your-app-name>`: Your deployed app name (e.g., `agent-openai-sdk-stm`)
- `<project-id>`, `<branch-id>`, `<database-id>`: Look these up using the **postgres API** (see below)

#### Finding your project, branch, and database IDs

Autoscaling Lakebase uses the **postgres API** (`/api/2.0/postgres/`), NOT the database API. Do NOT use `/api/2.0/database/` or `/api/2.0/lakebase/` — those are for provisioned instances.

```bash
# List projects — find your project ID
databricks api get /api/2.0/postgres/projects

# List branches for a project
databricks api get /api/2.0/postgres/projects/<project-id>/branches

# List databases for a branch
databricks api get /api/2.0/postgres/projects/<project-id>/branches/<branch-id>/databases
```

API docs: https://docs.databricks.com/api/workspace/postgres

Then re-run the app so it picks up the new resource:

```bash
databricks bundle run <your-app-resource-name>
```

> **Note:** This resource will be wiped on next `databricks bundle deploy`, so you must re-add it and re-run after each deploy.

### 4. Use autoscaling env vars in your agent code

In `agent_server/agent.py`, read the project and branch from env vars:

```python
LAKEBASE_AUTOSCALING_PROJECT = os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or None
LAKEBASE_AUTOSCALING_BRANCH = os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or None
```

Then pass them to your memory session:

```python
from databricks_openai.agents import AsyncDatabricksSession

async with AsyncDatabricksSession(
    project=LAKEBASE_AUTOSCALING_PROJECT,
    branch=LAKEBASE_AUTOSCALING_BRANCH,
) as session:
    result = await Runner.run(agent, input=messages, session=session)
```

### 5. Grant table permissions to the app's service principal

The app's service principal needs permissions on the memory tables. First, get the service principal **client ID** (UUID format):

```bash
databricks apps get <your-app-name> --output json | jq -r '.service_principal_client_id'
```

Then grant permissions using the `LakebaseClient`. **Run with `uv run`** from the template directory so `databricks-ai-bridge` is available.

> Upon first usage of stateful agent the schemas and tables below won't exist yet. Attempt the grants below, but if `grant_table` or `grant_all_tables_in_schema` calls fail because the table/schema doesn't exist, that's expected, not an error.

```python
from databricks_ai_bridge.lakebase import (
    LakebaseClient,
    SchemaPrivilege,
    TablePrivilege,
    SequencePrivilege,
)

INSTANCE_NAME = "<your-lakebase-instance>"
APP_SP = "<your-app-service-principal-client-id>"  # UUID from the command above

with LakebaseClient(instance_name=INSTANCE_NAME) as client:
    client.create_role(APP_SP, "SERVICE_PRINCIPAL")

    # Drizzle schema: migration metadata tables
    client.grant_schema(
        grantee=APP_SP,
        privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
        schemas=["drizzle"],
    )
    client.grant_all_tables_in_schema(
        grantee=APP_SP,
        privileges=[TablePrivilege.SELECT, TablePrivilege.INSERT, TablePrivilege.UPDATE],
        schemas=["drizzle"],
    )

    # App schema: business tables (Chat, Message, etc.)
    client.grant_schema(
        grantee=APP_SP,
        privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
        schemas=["ai_chatbot"],
    )
    client.grant_all_tables_in_schema(
        grantee=APP_SP,
        privileges=[TablePrivilege.SELECT, TablePrivilege.INSERT, TablePrivilege.UPDATE],
        schemas=["ai_chatbot"],
    )

    # Public schema: short-term memory tables
    client.grant_schema(
        grantee=APP_SP,
        privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
        schemas=["public"],
    )
    client.grant_table(
        grantee=APP_SP,
        privileges=[TablePrivilege.SELECT, TablePrivilege.INSERT, TablePrivilege.UPDATE, TablePrivilege.DELETE],
        tables=[
            "public.agent_sessions",
            "public.agent_messages",
        ],
    )
    # Sequences used by short-term memory tables
    client.grant_all_sequences_in_schema(
        grantee=APP_SP,
        privileges=[SequencePrivilege.USAGE, SequencePrivilege.SELECT, SequencePrivilege.UPDATE, SequencePrivilege.DELETE],
        schemas=["public"],
    )
```

## Deploy Sequence Summary

1. `databricks bundle deploy` — uploads code with PROJECT+BRANCH env vars
2. Add postgres resource via API (`PATCH /api/2.0/apps/<name>`) — grants the service principal permissions to Lakebase
3. Grant table permissions via `LakebaseClient` (step 5 above)
4. `databricks bundle run` — starts the app (reads PROJECT+BRANCH from env vars, has permissions via the postgres resource)

> **On subsequent deploys:** You must re-add the postgres resource via API (step 3) after each `databricks bundle deploy`, since DAB overwrites app resources. The `LakebaseClient` grants (step 5) persist and only need to be run once (unless the service principal changes).

## Notes

- The app uses `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` env vars to connect
- The postgres resource added via API is only for granting the service principal permissions
- For local development, set the same `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` in your `.env` file
- The permission grants persist across deployments, but must be re-run if the app's service principal changes
