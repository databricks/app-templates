# Virtual MCP server with tool search: guide for coding agents

A Databricks App that serves one MCP endpoint for the tools of several Unity Catalog MCP services, plus a tool-search endpoint. See `README.md` for what users do with it.

## Layout

```
server/
├── main.py             Entry point (`uv run virtual-mcp-search-server`), runs uvicorn
├── app.py              FastAPI routes (/, /api/*) and the ASGI entrypoint that serves /mcp and /mcp/search
├── proxy.py            The two MCP servers: merged tool listing, call routing, search_tools/call_tool
├── gateway.py          AI Gateway MCP client and the read-only Unity Catalog sign-in status API
├── tool_index.py       Tool-search index: Lakebase (pgvector + full text) or in-memory
├── config.py           Loads and validates virtual_mcp_config.json
├── request_context.py  The caller's token, workspace host, and the app's public URL
├── app_diagnostics.py  Synced from .scripts/source/ at the repo root. Don't edit here
└── static/             Explorer UI (plain HTML/CSS/JS, no build step)
tests/test_server.py    Runs without a workspace; the AI Gateway is faked
virtual_mcp_config.json Bundled default config, used when the volume has none
```

## Invariants

- **Every upstream call uses the caller's token**, from the `x-forwarded-access-token` header. A deployed app never falls back to its service principal for MCP or sign-in status calls. Only tool embeddings and Lakebase access use the service principal.
- **Tool names are `<alias>__<tool>`.** `proxy.call_tool` splits on the first `__` to route, and re-checks the service's selection, so a client can't call a tool the config doesn't expose.
- **No blocking I/O on the event loop.** Config loading, embeddings, and Lakebase run in worker threads (`asyncio.to_thread`). A blocking call on the loop under a throttled Unity Catalog stalls every route.
- **The MCP servers use the low-level `mcp` API** (`Server(on_list_tools=..., on_call_tool=...)`), not FastMCP: the tool list depends on the caller.
- **`/mcp` is dispatched outside FastAPI** in `app.application`. A Starlette mount would redirect `/mcp` to `/mcp/` using the internal host, which clients can't follow.
- **Index SQL is composed with `psycopg.sql`**, never f-strings. The schema name comes from an environment variable.
- **The search index is shared, so it only ranks.** `proxy.search_tools` passes the names of the tools the caller can list right now (cached 60 s per caller) and returns metadata from that listing, never from the index. The index never deletes rows, since listings differ by caller.
- **One broken service must not break the others.** `GatewayMcpClient._rpc` turns every failure into `UpstreamError`, which `proxy._list_service` reports as that service's error.
- **Config values go into URLs**, so `config.parse_config` only accepts three-part service names and plain aliases, and `gateway.py` URL-encodes them.
- **Local development runs as the developer** for requests without a forwarded token, so it binds `127.0.0.1` and `app.application` refuses non-loopback Host headers.

## Common changes

- **Change how tools are selected:** `ServiceSelection.matches` in `config.py`, with tests in `tests/test_server.py`.
- **Change search ranking:** `tool_index.search` and both backends' `rank`. Keep `LakebaseIndex` and `MemoryIndex` behaving alike.
- **Add an API for the UI:** a route in `app.py` that calls `_require_token` first.

## Checks

```bash
uv run pytest
uv run ruff check . && uv run ruff format --check --exclude server/app_diagnostics.py .
```

Databricks Apps scans deployed source with semgrep. Run the repo's `review-templates` skill before opening a PR.
- **Scopes are `ai-gateway` and `unity-catalog:read`.** The app only reads Unity Catalog. Apps can't hold the write-capable bare `unity-catalog` scope, so don't add features that change Unity Catalog state, such as revoking a user's sign-in.
