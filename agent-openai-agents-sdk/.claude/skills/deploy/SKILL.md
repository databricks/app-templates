---
name: deploy
description: "Deploy agent to Databricks Apps using DAB (Databricks Asset Bundles). Use when: (1) User says 'deploy', 'push to databricks', or 'bundle deploy', (2) 'App already exists' error occurs, (3) Need to bind/unbind existing apps, (4) Debugging deployed apps, (5) Querying deployed app endpoints."
---

# Deploy to Databricks Apps

## Deploy Commands

```bash
# Deploy the bundle (creates/updates resources, uploads files)
databricks bundle deploy

# Run the app (starts/restarts with uploaded source code)
databricks bundle run agent_openai_agents_sdk
```

The resource key `agent_openai_agents_sdk` matches the app name in `databricks.yml` under `resources.apps`.

## Handling "App Already Exists" Error

If `databricks bundle deploy` fails with:
```
Error: failed to create app
Failed to create app <app-name>. An app with the same name already exists.
```

**Ask the user:** "Would you like to bind the existing app to this bundle, or delete it and create a new one?"

### Option 1: Bind Existing App (Recommended)

**Step 1:** Find and match the app name in `databricks.yml`:
```bash
# List existing apps
databricks apps list --output json | jq '.[].name'
```

Update `databricks.yml` to match exactly:
```yaml
resources:
  apps:
    agent_openai_agents_sdk:
      name: "existing-app-name"  # Must match exactly
```

**Step 2:** Bind the resource:
```bash
databricks bundle deployment bind agent_openai_agents_sdk <existing-app-name>

# Skip confirmation prompts
databricks bundle deployment bind agent_openai_agents_sdk <existing-app-name> --auto-approve
```

**Step 3:** Deploy:
```bash
databricks bundle deploy
databricks bundle run agent_openai_agents_sdk
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
databricks bundle deployment unbind agent_openai_agents_sdk
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

- **Name is immutable**: Changing the `name` field in `databricks.yml` forces app replacement (destroy + create)
- **Remote Terraform state**: Databricks stores state remotely; same app detected across directories
- **Review the plan**: Look for `# forces replacement` in Terraform output before confirming

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Permission errors at runtime | Grant resources in `databricks.yml` (see **add-resource** skill) |
| App not starting | Check `databricks apps logs <app-name>` |
| Auth token expired | Run `databricks auth token` again |
