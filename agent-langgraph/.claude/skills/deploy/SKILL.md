---
name: deploy
description: "Deploy agent to Databricks Apps using DAB (Databricks Asset Bundles). Use when: (1) User says 'deploy', 'push to databricks', or 'bundle deploy', (2) 'App already exists' error occurs, (3) Need to bind/unbind existing apps, (4) Debugging deployed apps, (5) Querying deployed app endpoints."
---

# Deploy to Databricks Apps

## Deploy Commands

**IMPORTANT:** Always run BOTH commands to deploy and start your app:

```bash
# 1. Deploy the bundle (creates/updates resources, uploads files)
databricks bundle deploy

# 2. Run the app (starts/restarts with uploaded source code) - REQUIRED!
databricks bundle run agent_langgraph
```

> **Note:** `bundle deploy` only uploads files and configures resources. `bundle run` is **required** to actually start/restart the app with the new code. If you only run `deploy`, the app will continue running old code!

The resource key `agent_langgraph` matches the app name in `databricks.yml` under `resources.apps`.

## Handling "App Already Exists" Error

If `databricks bundle deploy` fails with:
```
Error: failed to create app
Failed to create app <app-name>. An app with the same name already exists.
```

**Ask the user:** "Would you like to bind the existing app to this bundle, or delete it and create a new one?"

### Option 1: Bind Existing App (Recommended)

**Step 1:** Get the existing app's full configuration:
```bash
# Get app config including budget_policy_id and other server-side settings
databricks apps get <existing-app-name> --output json | jq '{name, budget_policy_id, description}'
```

**Step 2:** Update `databricks.yml` to match the existing app's configuration exactly:
```yaml
resources:
  apps:
    agent_langgraph:
      name: "existing-app-name"  # Must match exactly
      budget_policy_id: "xxx-xxx-xxx"  # Copy from step 1 if present
```

> **Why this matters:** Existing apps may have server-side configuration (like `budget_policy_id`) that isn't in your bundle. If these don't match, Terraform will fail with "Provider produced inconsistent result after apply". Always sync the app's current config to `databricks.yml` before binding.

**Step 3:** If deploying to a `mode: production` target, set `workspace.root_path`:
```yaml
targets:
  prod:
    mode: production
    workspace:
      root_path: /Workspace/Users/${workspace.current_user.userName}/.bundle/${bundle.name}/${bundle.target}
```

> **Why this matters:** Production mode requires an explicit root path to ensure only one copy of the bundle is deployed. Without this, the deploy will fail with a recommendation to set `workspace.root_path`.

**Step 4:** Check if already bound, then bind if needed:
```bash
# Check if resource is already managed by this bundle
databricks bundle summary --output json | jq '.resources.apps'

# If the app appears in the summary, skip binding and go to Step 5
# If NOT in summary, bind the resource:
databricks bundle deployment bind agent_langgraph <existing-app-name> --auto-approve
```

> **Note:** If bind fails with "Resource already managed by Terraform", the app is already bound to this bundle. Skip to Step 5 and deploy directly.

**Step 5:** Deploy:
```bash
databricks bundle deploy
databricks bundle run agent_langgraph
```

### Option 2: Delete and Recreate

```bash
databricks apps delete <app-name>
databricks bundle deploy
```

**Warning:** This permanently deletes the app's URL, OAuth credentials, and service principal.

## Unbinding an App

To remove the link between bundle and deployed app:

```bash
databricks bundle deployment unbind agent_langgraph
```

Use when:
- Switching to a different app
- Letting bundle create a new app
- Switching between deployed instances

Note: Unbinding doesn't delete the deployed app.

## Query Deployed App

**Get OAuth token** (PATs not supported):
```bash
databricks auth token
```

**Send request:**
```bash
curl -X POST <app-url>/invocations \
  -H "Authorization: Bearer <oauth-token>" \
  -H "Content-Type: application/json" \
  -d '{ "input": [{ "role": "user", "content": "hi" }], "stream": true }'
```

## Debug Deployed Apps

```bash
# View logs (follow mode)
databricks apps logs <app-name> --follow

# Check app status
databricks apps get <app-name> --output json | jq '{app_status, compute_status}'

# Get app URL
databricks apps get <app-name> --output json | jq -r '.url'
```

## Important Notes

- **App naming convention**: App names must be prefixed with `agent-` (e.g., `agent-my-assistant`, `agent-data-analyst`)
- **Name is immutable**: Changing the `name` field in `databricks.yml` forces app replacement (destroy + create)
- **Remote Terraform state**: Databricks stores state remotely; same app detected across directories
- **Review the plan**: Look for `# forces replacement` in Terraform output before confirming

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Permission errors at runtime | Grant resources in `databricks.yml` (see **add-tools** skill) |
| App not starting | Check `databricks apps logs <app-name>` |
| Auth token expired | Run `databricks auth token` again |
| "Provider produced inconsistent result" | Sync app config to `databricks.yml`|
| "should set workspace.root_path" | Add `root_path` to production target |
| App running old code after deploy | Run `databricks bundle run agent_langgraph` after deploy |
| Env var is None in deployed app | Check `valueFrom` in app.yaml matches resource `name` in databricks.yml |
