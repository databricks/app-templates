# Development Scripts

Scripts for testing and developing the MCP server.

## Quick Reference

| Script | Purpose | Environment |
|--------|---------|-------------|
| `query_remote.sh` | Test deployed app (interactive OAuth) | Databricks App |
| `start_server.sh` | Start local dev server | `localhost:8000` |
| `generate_oauth_token.py` | Generate OAuth tokens | Any |

## Testing

### Local Testing
```bash
./scripts/dev/start_server.sh  # Terminal 1
```

With the server running you can run the `query_local.py` file to test the server locally. `query_local.py` lists and returns all the available tools. Uncomment code as necessary in the script to call an individual tool.
```bash
python query_local.py # Terminal 2
```

### Remote Testing
```bash
# Interactive (walks you through OAuth)
./scripts/dev/query_remote.sh

Tests: All tools with user-level OAuth authentication

## Development Workflow

1. Add tool to `server/tools.py`
3. Test locally: Either follow the local testing above or run the integration tests
4. Deploy to Databricks Apps
5. Test deployed: `./scripts/dev/query_remote.sh`

