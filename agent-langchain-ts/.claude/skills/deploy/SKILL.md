---
name: deploy
description: "Build, validate, and deploy TypeScript LangChain agent to Databricks Apps. Use when: (1) User wants to deploy, (2) User says 'deploy', 'push to databricks', 'production', (3) After making changes that need deployment."
---

# Deploy to Databricks

## Deployment Targets

| Target | Command | Naming | Notes |
|--------|---------|--------|-------|
| **dev** (default) | `databricks bundle deploy -t dev` | `db-agent-langchain-ts-<username>` | User-scoped, auto-created resources |
| **prod** | `databricks bundle deploy -t prod` | `db-agent-langchain-ts-prod` | Stricter permissions, fixed naming |

---

## Deploy Workflow

### 1. Build and Test Locally

```bash
npm run dev    # Test locally first
npm test       # Run tests
npm run build  # Verify build
```

### 2. Validate Bundle

```bash
databricks bundle validate -t dev
```

Checks `databricks.yml` syntax, `app.yaml` config, resource references, and variable interpolation.

### 3. Deploy

```bash
databricks bundle deploy -t dev
```

### 4. Start App

```bash
databricks bundle run agent_langchain_ts
```

### 5. Verify

```bash
# Check status
databricks apps get db-agent-langchain-ts-<username>

# Follow logs
databricks apps logs db-agent-langchain-ts-<username> --follow

# Test health endpoint
curl https://<workspace-host>/apps/db-agent-langchain-ts-<username>/health

# Test chat
curl -X POST https://<workspace-host>/apps/db-agent-langchain-ts-<username>/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <databricks-token>" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'
```

---

## Update or Redeploy

```bash
# After code/config changes:
databricks bundle deploy -t dev
databricks apps restart db-agent-langchain-ts-<username>
```

### Bind Existing App

```bash
databricks bundle deploy -t dev --force-bind
```

### Delete and Recreate

```bash
databricks apps delete db-agent-langchain-ts-<username>
databricks bundle deploy -t dev
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "App with same name already exists" | `databricks bundle deploy -t dev --force-bind` or delete first |
| "Permission denied on serving endpoint" | Add endpoint to `app.yaml` resources with `permission: CAN_QUERY` |
| "Experiment not found" | Add experiment to `databricks.yml` resources (auto-creates on deploy) |
| "App failed to start" | Check logs: `databricks apps logs <app-name>`. Common: missing deps, bad start command, missing env vars |
| "Cannot reach app URL" | Verify app state: `databricks apps get <app-name> \| jq -r .state` and URL: `jq -r .url` |

## Related Skills

- **quickstart**: Initial setup and authentication
- **run-locally**: Local development and testing
- **modify-agent**: Making changes to agent configuration
