# Common Issues and Troubleshooting

## Agent Not Starting

**Port already in use:**
```bash
# Kill process on port 5001
lsof -ti:5001 | xargs kill -9

# Rebuild
npm run build:agent

# Start
npm run dev:agent
```

**Build errors:**
```bash
# Clean rebuild
rm -rf dist node_modules
npm install
npm run build
```

## Tests Failing

**Ensure servers are running:**
```bash
# Terminal 1: Start servers
npm run dev

# Terminal 2: Run tests
npm run test:integration
```

**Check configuration:**
- Verify `.env` file exists
- Check `DATABRICKS_MODEL` is set
- Ensure authentication is configured

## Deployment Errors

**Validate bundle:**
```bash
databricks bundle validate
```

**Check app status:**
```bash
databricks apps get <app-name>
```

**View logs:**
```bash
databricks apps logs <app-name> --follow
```

**"App Already Exists":**
Either bind to existing app or delete it:
```bash
# Delete existing app
databricks apps delete <app-name>

# Or bind to it in databricks.yml
resources:
  apps:
    agent_langchain_ts:
      name: <existing-app-name>
```

## UI Issues

**UI not loading:**
```bash
# Rebuild UI
npm run build:ui

# Check UI files exist
ls -la ui/client/dist
ls -la ui/server/dist
```

**API errors:**
- Check `API_PROXY` environment variable points to agent (if using separate servers)
- Verify agent is running on expected port
- Check plugin configuration in `src/main.ts`

## Permission Errors

Add required resources to `databricks.yml`:

```yaml
resources:
  apps:
    agent_langchain_ts:
      resources:
        - name: my-resource
          <resource-type>:
            <resource-config>
            permission: <PERMISSION>
```

See [add-tools skill](../add-tools/SKILL.md) for details.
