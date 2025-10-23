# Development Scripts

Scripts for testing and developing the MCP server.

## Quick Reference

| Script | Purpose | Environment |
|--------|---------|-------------|
| `test_local.sh` | Test all tools locally | `localhost:8000` |
| `test_remote.sh` | Test deployed app (interactive OAuth) | Databricks App |
| `start_server.sh` | Start local dev server | `localhost:8000` |
| `generate_oauth_token.py` | Generate OAuth tokens | Any |

## Testing

### Local Testing
```bash
# Automated (starts server, tests, stops)
./scripts/dev/test_local.sh

# Manual
./scripts/dev/start_server.sh  # Terminal 1
python scripts/dev/test_local.py  # Terminal 2
```

Tests: `health`, `get_current_user` (uses Databricks CLI auth)

### Remote Testing
```bash
# Interactive (walks you through OAuth)
./scripts/dev/test_remote.sh

# Manual
python scripts/dev/test_remote.py \
    --host https://your-workspace.cloud.databricks.com \
    --token your-oauth-token \
    --app-url https://your-workspace.cloud.databricks.com/serving-endpoints/your-app
```

Tests: All tools with user-level OAuth authentication

## Development Workflow

1. Add tool to `server/tools.py`
2. **Add test call** in `test_local.py` and `test_remote.py` (see TODO comments)
3. Test locally: `./scripts/dev/test_local.sh`
4. Deploy to Databricks Apps
5. Test deployed: `./scripts/dev/test_remote.sh`

## Adding New Tools

When you add a new tool to `server/tools.py`, update the test files to call it:

1. **`test_local.py`** - Add a test step (look for `TODO: Add new tool tests here`)
2. **`test_remote.py`** - Add a test step (look for `TODO: Add new tool tests here`)

Example test step:
```python
# Test your_new_tool
print("Step N: Testing 'your_new_tool' tool...")
print("-" * 70)
try:
    result = mcp_client.call_tool("your_new_tool", param1="value")
    print(result)
    print("-" * 70)
    print("✓ your_new_tool test passed!")
except Exception as e:
    print(f"✗ Error calling your_new_tool: {e}")
    print("-" * 70)
print()
```

