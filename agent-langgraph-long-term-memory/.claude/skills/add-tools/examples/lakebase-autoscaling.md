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
databricks bundle run agent_langgraph  # Required to create the app before adding resources
```

### 3. Add the postgres resource via API (for permissions only)

After the app is deployed, add the postgres resource using the Databricks API. This grants the app's service principal access to Lakebase — the app reads PROJECT+BRANCH from env vars, not from this resource:
```bash
databricks api patch /api/2.0/apps/<your-app-name> \
  --json '{
    "resources": [{
      "name": "postgres",
      "postgres": {
        "branch": "projects/<project-id>/branches/<branch-id>",
        "database": "projects/<project-id>/branches/<branch-id>/databases/<database-id>",
        "permission": "CAN_CONNECT_AND_CREATE"
      }
    }]
  }'
```

Replace the placeholders:
- `<your-app-name>`: Your deployed app name (e.g., `agent-langgraph-stm`)
- `<project-id>`: Your Lakebase project ID
- `<branch-id>`: Your Lakebase branch ID
- `<database-id>`: Your Lakebase database ID

> **Note:** This resource will be wiped on next `databricks bundle deploy`, so you must re-add it after each deploy.

### 4. Use autoscaling env vars in your agent code

In `agent_server/agent.py`, read the project and branch from env vars:

```python
LAKEBASE_AUTOSCALING_PROJECT = os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or None
LAKEBASE_AUTOSCALING_BRANCH = os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or None
```

Then pass them to your memory store:

```python
from databricks_langchain import AsyncCheckpointSaver, AsyncDatabricksStore

# For short-term memory:
async with AsyncCheckpointSaver(
    project=LAKEBASE_AUTOSCALING_PROJECT,
    branch=LAKEBASE_AUTOSCALING_BRANCH,
) as saver:
    ...

# For long-term memory:
async with AsyncDatabricksStore(
    project=LAKEBASE_AUTOSCALING_PROJECT,
    branch=LAKEBASE_AUTOSCALING_BRANCH,
    embedding_endpoint=EMBEDDING_ENDPOINT,
    embedding_dims=EMBEDDING_DIMS,
) as store:
    ...
```

### 5. Grant table permissions to the app's service principal

The app's service principal needs permissions on the memory tables. First, get the service principal ID:

```bash
databricks apps get <your-app-name> --output json | jq -r '.service_principal_id'
```

Then grant permissions using the `LakebaseClient`. The required tables differ by memory type:

#### Short-term memory (`AsyncCheckpointSaver`)

```python
from databricks_ai_bridge.lakebase import (
    LakebaseClient,
    SchemaPrivilege,
    TablePrivilege,
)

INSTANCE_NAME = "<your-lakebase-instance>"
APP_SP = "<your-app-service-principal-id>"  # from the command above

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

    # Public schema: checkpoint tables
    client.grant_schema(
        grantee=APP_SP,
        privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
        schemas=["public"],
    )
    client.grant_table(
        grantee=APP_SP,
        privileges=[TablePrivilege.SELECT, TablePrivilege.INSERT, TablePrivilege.UPDATE],
        tables=[
            "public.checkpoint_migrations",
            "public.checkpoint_writes",
            "public.checkpoints",
            "public.checkpoint_blobs",
        ],
    )
```

#### Long-term memory (`AsyncDatabricksStore`)

```python
from databricks_ai_bridge.lakebase import (
    LakebaseClient,
    SchemaPrivilege,
    TablePrivilege,
)

INSTANCE_NAME = "<your-lakebase-instance>"
APP_SP = "<your-app-service-principal-id>"  # from the command above

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

    # Public schema: store tables
    client.grant_schema(
        grantee=APP_SP,
        privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
        schemas=["public"],
    )
    client.grant_table(
        grantee=APP_SP,
        privileges=[TablePrivilege.SELECT, TablePrivilege.INSERT, TablePrivilege.UPDATE],
        tables=[
            "public.store_migrations",
            "public.store",
            "public.store_vectors",
            "public.vector_migrations",
        ],
    )
```

## Deploy Sequence Summary

1. `databricks bundle deploy` — uploads code with PROJECT+BRANCH env vars
2. Add postgres resource via API (`PATCH /api/2.0/apps/<name>`) — grants the service principal permissions to Lakebase
3. Grant table permissions via `LakebaseClient` (step 5 above)
4. `databricks bundle run` — starts the app (reads PROJECT+BRANCH from env vars, has permissions via the postgres resource)

> **On subsequent deploys:** You must re-add the postgres resource via API (step 3) after each `databricks bundle deploy`, since DAB overwrites app resources. The `LakebaseClient` grants (step 5) persist and only need to be run once (unless the service principal changes).

## Notes

- The app uses `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` env vars to connect — NOT `PGENDPOINT`
- The postgres resource added via API is only for granting the service principal permissions, not for env var injection
- For local development, set the same `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` in your `.env` file
- The permission grants persist across deployments, but must be re-run if the app's service principal changes
