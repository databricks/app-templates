---
name: deploy
description: "Deploy TypeScript LangChain agent to Databricks. Use when: (1) User wants to deploy, (2) User says 'deploy', 'push to databricks', 'production', (3) After making changes that need deployment."
---

# Deploy to Databricks

## Quick Deploy

```bash
# Validate configuration
databricks bundle validate -t dev

# Deploy to dev environment
databricks bundle deploy -t dev

# Start the app
databricks bundle run agent_langchain_ts
```

## Deployment Targets

### Development (dev)
```bash
databricks bundle deploy -t dev
```

**Characteristics:**
- Default target
- User-scoped naming: `db-agent-langchain-ts-<username>`
- Development mode permissions
- Auto-created resources

### Production (prod)
```bash
databricks bundle deploy -t prod
```

**Characteristics:**
- Production mode
- Stricter permissions
- Fixed naming: `db-agent-langchain-ts-prod`
- Requires explicit configuration

## Step-by-Step Deployment

### 1. Prepare Code

Ensure code is committed and tested:
```bash
# Test locally first
npm run dev

# Run tests
npm test

# Verify build works
npm run build
```

### 2. Validate Bundle

```bash
databricks bundle validate -t dev
```

This checks:
- `databricks.yml` syntax
- `app.yaml` configuration
- Resource references
- Variable interpolation

### 3. Deploy Bundle

```bash
databricks bundle deploy -t dev
```

This will:
- Create MLflow experiment if needed
- Upload source code
- Configure app environment
- Grant resource permissions
- Create app instance

### 4. Start App

```bash
databricks bundle run agent_langchain_ts
```

Or manually:
```bash
databricks apps start db-agent-langchain-ts-<username>
```

### 5. Verify Deployment

```bash
# Check app status
databricks apps get db-agent-langchain-ts-<username>

# View logs
databricks apps logs db-agent-langchain-ts-<username> --follow

# Test health endpoint
curl https://<workspace-host>/apps/db-agent-langchain-ts-<username>/health
```

## Managing Existing Apps

### Bind Existing App

If app already exists:

```bash
# Get app details
databricks apps get db-agent-langchain-ts-<username>

# Bind to bundle
databricks bundle deploy -t dev --force-bind
```

### Delete and Recreate

```bash
# Delete existing app
databricks apps delete db-agent-langchain-ts-<username>

# Deploy fresh
databricks bundle deploy -t dev
```

## Configuration Files

### databricks.yml

Main bundle configuration:

```yaml
bundle:
  name: agent-langchain-ts

variables:
  serving_endpoint_name:
    default: "databricks-claude-sonnet-4-5"

resources:
  experiments:
    agent_experiment:
      name: /Users/${workspace.current_user.userName}/agent-langchain-ts

  apps:
    agent_langchain_ts:
      name: db-agent-langchain-ts-${var.resource_name_suffix}
      source_code_path: ./
      resources:
        - name: serving-endpoint
          serving_endpoint:
            name: ${var.serving_endpoint_name}
            permission: CAN_QUERY
```

### app.yaml

Runtime configuration:

```yaml
command:
  - npm
  - start

env:
  - name: DATABRICKS_MODEL
    value: "databricks-claude-sonnet-4-5"
  - name: MLFLOW_TRACKING_URI
    value: "databricks"
  - name: MLFLOW_EXPERIMENT_ID
    valueFrom: "experiment"

resources:
  - name: serving-endpoint
    serving_endpoint:
      name: ${var.serving_endpoint_name}
      permission: CAN_QUERY
```

## Viewing Deployed App

### Get App URL

```bash
databricks apps get db-agent-langchain-ts-<username> --output json | jq -r .url
```

### Access App

Navigate to:
```
https://<workspace-host>/apps/db-agent-langchain-ts-<username>
```

### Test Deployed App

```bash
# Health check
curl https://<workspace-host>/apps/db-agent-langchain-ts-<username>/health

# Chat request
curl -X POST https://<workspace-host>/apps/db-agent-langchain-ts-<username>/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <databricks-token>" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

## Monitoring

### View Logs

```bash
# Follow logs in real-time
databricks apps logs db-agent-langchain-ts-<username> --follow

# Get last 100 lines
databricks apps logs db-agent-langchain-ts-<username> --tail 100

# Filter logs
databricks apps logs db-agent-langchain-ts-<username> | grep ERROR
```

### View MLflow Traces

See [MLflow Tracing Guide](../_shared/MLFLOW.md) for viewing traces in your workspace.

### App Metrics

```bash
# Get app details
databricks apps get db-agent-langchain-ts-<username> --output json

# Check app state
databricks apps get db-agent-langchain-ts-<username> --output json | jq -r .state
```

## Updating Deployed App

### Update Code

```bash
# Make changes to code
# Then redeploy
databricks bundle deploy -t dev

# Restart app
databricks apps restart db-agent-langchain-ts-<username>
```

### Update Configuration

Edit `app.yaml` or `databricks.yml`, then:

```bash
databricks bundle deploy -t dev
databricks apps restart db-agent-langchain-ts-<username>
```

## Adding Resources

### Add Serving Endpoint Permission

Edit `app.yaml`:

```yaml
resources:
  - name: serving-endpoint
    serving_endpoint:
      name: "your-endpoint-name"
      permission: CAN_QUERY
```

Then redeploy:
```bash
databricks bundle deploy -t dev
```

### Add Unity Catalog Function

Edit `databricks.yml`:

```yaml
resources:
  - name: uc-function
    function:
      name: "catalog.schema.function_name"
      permission: EXECUTE
```

Update `app.yaml` to pass function config:

```yaml
env:
  - name: UC_FUNCTION_CATALOG
    value: "catalog"
  - name: UC_FUNCTION_SCHEMA
    value: "schema"
  - name: UC_FUNCTION_NAME
    value: "function_name"
```

Redeploy:
```bash
databricks bundle deploy -t dev
```

## Troubleshooting

### "App with same name already exists"

Either bind existing app:
```bash
databricks bundle deploy -t dev --force-bind
```

Or delete and recreate:
```bash
databricks apps delete db-agent-langchain-ts-<username>
databricks bundle deploy -t dev
```

### "Permission denied on serving endpoint"

Ensure endpoint is listed in `app.yaml` resources:
```yaml
resources:
  - name: serving-endpoint
    serving_endpoint:
      name: "databricks-claude-sonnet-4-5"
      permission: CAN_QUERY
```

### "Experiment not found"

Create experiment:
```bash
databricks experiments create \
  --experiment-name "/Users/$(databricks current-user me --output json | jq -r .userName)/agent-langchain-ts"
```

Or update `databricks.yml` to auto-create:
```yaml
resources:
  experiments:
    agent_experiment:
      name: /Users/${workspace.current_user.userName}/agent-langchain-ts
```

### "App failed to start"

Check logs:
```bash
databricks apps logs db-agent-langchain-ts-<username>
```

Common issues:
- Missing dependencies in `package.json`
- Incorrect `npm start` command in `app.yaml`
- Missing environment variables
- Build errors

### "Cannot reach app URL"

Verify:
1. App is running: `databricks apps get <app-name> | jq -r .state`
2. URL is correct: `databricks apps get <app-name> | jq -r .url`
3. Authentication token is valid

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy to Databricks

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Run tests
        run: npm test

      - name: Install Databricks CLI
        run: |
          curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh

      - name: Deploy to Databricks
        env:
          DATABRICKS_HOST: ${{ secrets.DATABRICKS_HOST }}
          DATABRICKS_TOKEN: ${{ secrets.DATABRICKS_TOKEN }}
        run: |
          databricks bundle deploy -t prod
          databricks bundle run agent_langchain_ts
```

## Best Practices

1. **Test Locally First**: Always test with `npm run dev` before deploying
2. **Use Dev Environment**: Test deployments in dev before prod
3. **Monitor Logs**: Check logs after deployment
4. **Version Control**: Commit changes before deploying
5. **Resource Permissions**: Verify all required resources are granted in `app.yaml`
6. **MLflow Traces**: Monitor traces to debug issues
7. **Incremental Updates**: Make small changes and test frequently

## Related Skills

- **quickstart**: Initial setup and authentication
- **run-locally**: Local development and testing
- **modify-agent**: Making changes to agent configuration
