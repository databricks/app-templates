# Autoscaling Postgres Lakebase Instances (not provisioned)

Autoscaling Lakebase postgres resources are **not yet supported as resource dependencies in `databricks.yml`**. Use `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` as static env vars, and add the postgres resource via API after deploy. The postgres resource serves two purposes: (1) granting the app's service principal access to Lakebase, and (2) on the next redeploy, injecting database connection env vars that the frontend (chat UI) needs.

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

### 3. Add the postgres resource via API

After the app is deployed, add the postgres resource using the Databricks API. This grants the app's service principal access to Lakebase. The frontend connection env vars are injected later when the app is redeployed (step 5). The agent backend reads PROJECT+BRANCH from the static env vars you set in step 1.

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

### 4. Grant table permissions to the app's service principal

The app's service principal needs permissions on the memory tables **before** the app redeploys and runs migrations. Use the `scripts/grant_lakebase_permissions.py` script included in the template.

First, get the service principal **client ID** (UUID format):

```bash
databricks apps get <your-app-name> --output json | jq -r '.service_principal_client_id'
```

Then run the grant script. Pass `--instance-name` for provisioned instances, or `--project` + `--branch` for autoscaling (the script also reads these from `.env` if set):

```bash
# Provisioned:
uv run python scripts/grant_lakebase_permissions.py <sp-client-id> --instance-name <name>

# Autoscaling:
uv run python scripts/grant_lakebase_permissions.py <sp-client-id> --project <project> --branch <branch>
```

> Upon first usage of stateful agent the schemas and tables below won't exist yet. Attempt the grants below, but if `grant_table` or `grant_all_tables_in_schema` calls fail because the table/schema doesn't exist, that's expected, not an error.

### 5. Redeploy the app to pick up the postgres resource

After adding the postgres resource and granting permissions, you **must** redeploy the app so it picks up the database connection env vars injected by the resource. The SP now has CREATE on schemas, so drizzle migrations will succeed on startup.

```bash
# Use `databricks apps deploy` (NOT `databricks bundle deploy`, which would wipe the resource you just added)
databricks apps deploy <your-app-name> \
  --source-code-path <source-code-path>
```

To find the `source-code-path`, check the app's current deployment:
```bash
databricks apps get <your-app-name> --output json | jq -r '.active_deployment.source_code_path'
```

> **Note:** The postgres resource will be wiped on next `databricks bundle deploy`, so you must re-add it (step 3), re-grant (step 4), and redeploy (step 5) after each bundle deploy.

### 6. Use autoscaling env vars in your agent code

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

## Deploy Sequence Summary

1. `databricks bundle deploy` + `databricks bundle run` — uploads code and starts the app with PROJECT+BRANCH env vars
2. Add postgres resource via API (`PATCH /api/2.0/apps/<name>`) — grants the SP permissions to Lakebase
3. Grant table permissions via `scripts/grant_lakebase_permissions.py` — use the SP client ID from `databricks apps get`
4. **Redeploy the app** (`databricks apps deploy`) — injects frontend connection env vars from the postgres resource and restarts the app; migrations succeed because the SP already has CREATE on schemas

> **On subsequent `databricks bundle deploy`s:** DAB overwrites app resources, wiping the postgres resource. You must re-add it via API (step 2), re-grant (step 3), and redeploy (step 4) after each bundle deploy. The `LakebaseClient` grants persist and only need to be re-run if the service principal changes.

## Notes

- The agent backend uses `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` env vars to connect
- The postgres resource added via API grants the SP permissions to Lakebase; the frontend connection env vars are only injected when the app is redeployed (step 4)
- After adding the postgres resource, you **must redeploy** (`databricks apps deploy`) for the app to pick up those injected env vars
- For local development, set the same `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` in your `.env` file
- The permission grants persist across deployments, but must be re-run if the app's service principal changes
