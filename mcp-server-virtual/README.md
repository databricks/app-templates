# Virtual MCP server for Databricks Apps

This app template combines the tools of several [Unity Catalog MCP services](https://docs.databricks.com/aws/en/generative-ai/mcp/) (for example GitHub, Slack, and Genie) behind one MCP endpoint. You choose which services and which of their tools to expose. Every user signs in to each service once, from the app, and the app routes each tool call to the service that owns it, as that user.

It also serves a tool-search endpoint. Instead of listing every tool, it exposes two: one finds the tools relevant to a task, the other runs one. An agent connected to dozens of services then loads a handful of tool schemas instead of all of them.

See [Quickstart](#quickstart) to deploy it.

## Overview

| Path | What it serves |
|------|----------------|
| `/mcp` | An MCP server listing every selected tool, named `<alias>__<tool>` (for example `github__search_pull_requests`) |
| `/mcp/search` | An MCP server listing only `search_tools(query, top_n)` and `call_tool(name, arguments)` |
| `/` | An explorer: sign in to each service, browse and search tools, and try them |

How it works:

1. **Configuration.** `virtual_mcp_config.json` in a Unity Catalog volume lists the services to combine and, optionally, which of their tools to expose.
2. **Routing.** Tool listings and calls go through the [AI Gateway](https://docs.databricks.com/aws/en/ai-gateway/) to each service, with the signed-in user's token ([on-behalf-of-user authorization](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth#user-authorization)). Results respect that user's own grants and credentials.
3. **Sign-in.** The app walks the user through the platform sign-in page of each service that needs it.
4. **Tool search.** Each tool's name and description is embedded with a serving endpoint and stored in [Lakebase](https://docs.databricks.com/aws/en/oltp/) with pgvector. A search combines vector similarity with Postgres full-text ranking (reciprocal-rank fusion), so it matches both exact words ("jira") and paraphrases ("schedule a meeting"). It ranks only the tools the caller can list right now, so it never returns another user's tools. The index refreshes whenever tools are listed and re-embeds only tools that changed.

## Quickstart

### Prerequisites

1. A workspace with [user authorization](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth#user-authorization) enabled for Databricks Apps.
2. The Unity Catalog MCP services you want to combine, for example the built-in `system.ai.*` services.
3. A [Lakebase](https://docs.databricks.com/aws/en/oltp/) database for the tool-search index.
4. An embedding serving endpoint that returns 1024-dimension vectors, such as `databricks-gte-large-en` or `databricks-bge-large-en`.
5. The [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/install).

### 1. Choose the services

Write a `virtual_mcp_config.json`. The one bundled with this template is a working example:

```json
{
  "services": [
    { "name": "system.ai.web_search" },
    { "name": "system.ai.genie_one_mcp", "alias": "genie" },
    { "name": "system.ai.github", "include_regex": "^(get|list|search)_" },
    { "name": "system.ai.slack", "include_tools": ["slack_search_channels", "slack_read_channel", "slack_send_message"] }
  ]
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `name` | Yes | Full name of the MCP service in Unity Catalog |
| `alias` | No | Prefix of the service's tools. Defaults to the last part of `name` |
| `include_tools` | No | Tools to expose, by name |
| `include_regex` | No | Expose tools whose name matches this regular expression (case-insensitive) |

With neither `include_tools` nor `include_regex`, every tool of the service is exposed. With both, a tool is exposed if it matches either.

[Upload](https://docs.databricks.com/aws/en/ingestion/file-upload/upload-to-volume) the file to the root of a Unity Catalog volume:

```bash
databricks fs cp virtual_mcp_config.json dbfs:/Volumes/<catalog>/<schema>/<volume>/virtual_mcp_config.json
```

If the volume has no `virtual_mcp_config.json`, the app uses the bundled one. If the file can't be read or is invalid, the app exposes no services until it is fixed and the app restarted. The explorer shows which config is active, or the error.

### 2. Enable pgvector

As the owner of the Lakebase project, install the extension once. The app's service principal can't install it:

```bash
databricks psql --project <project-name> -- -c "CREATE EXTENSION IF NOT EXISTS vector"
```

Without it, tool search still works, using an in-memory index that is rebuilt after every restart. `GET /api/index-status` shows which one is in use.

### 3. Create the app

**From the template UI.** In the workspace, click **New > App**, choose this template, and pick the three resources:

| Resource key | Pick |
|--------------|------|
| `uc-volume` | The volume with `virtual_mcp_config.json` |
| `postgres` | The Lakebase database |
| `serving-endpoint` | The embedding endpoint |

Give the app a name that starts with `mcp-`. That makes it discoverable as an MCP server in Databricks product UIs such as the [AI Playground](https://docs.databricks.com/aws/en/large-language-models/ai-playground).

**From the CLI.** Create the app with the same resources and the `ai-gateway` user scope, then deploy this directory:

```bash
APP_NAME="mcp-virtual"
databricks apps create --json '{
  "name": "'"$APP_NAME"'",
  "user_api_scopes": ["ai-gateway"],
  "resources": [
    {"name": "uc-volume", "uc_securable": {"securable_type": "VOLUME", "securable_full_name": "<catalog>.<schema>.<volume>", "permission": "READ_VOLUME"}},
    {"name": "postgres", "postgres": {"branch": "projects/<project>/branches/<branch>", "database": "projects/<project>/branches/<branch>/databases/<database>", "permission": "CAN_CONNECT_AND_CREATE"}},
    {"name": "serving-endpoint", "serving_endpoint": {"name": "databricks-gte-large-en", "permission": "CAN_QUERY"}}
  ]
}'
DATABRICKS_USERNAME=$(databricks current-user me | jq -r .userName)
databricks sync . "/Users/$DATABRICKS_USERNAME/$APP_NAME"
databricks apps deploy "$APP_NAME" --source-code-path "/Workspace/Users/$DATABRICKS_USERNAME/$APP_NAME"
```

### 4. (Optional) Enable revoke

With only the `ai-gateway` scope, users can sign in, list tools and call them. Two features read the user's stored credentials in Unity Catalog and need the `unity-catalog` scope:

- **Revoke**, which signs the user out of a service from the app.
- **"No sign-in needed"** labels, for services that take no per-user credential.

`unity-catalog` can't be set in `user_api_scopes`, so an account admin adds it to the app's OAuth integration. Do this **before anyone signs in to the app**: a user's consent is fixed at the scopes the app had at their first sign-in.

```bash
INTEGRATION_ID=$(databricks apps get "$APP_NAME" -o json | jq -r .oauth2_app_integration_id)
databricks account custom-app-integration get "$INTEGRATION_ID" -o json \
  | jq '{scopes: (.scopes + ["unity-catalog"] | unique)}' \
  | databricks account custom-app-integration update "$INTEGRATION_ID" --json @-
databricks account custom-app-integration update "$INTEGRATION_ID" \
  --json '{"user_authorized_scopes": ["ai-gateway", "unity-catalog"]}'
```

Use `unity-catalog`, not `unity-catalog:read`: the read-only scope can't revoke. The change takes up to 10 minutes to apply.

### 5. Sign in and connect

Open the app and click **Sign in to all**. A window opens and walks you through the sign-in page of each service that needs one. Allow popups for the app if your browser blocks it.

Then point an MCP client at one of the endpoints. The URL must not end with a slash:

```
https://<app-url>/mcp           # every tool
https://<app-url>/mcp/search    # tool search
```

- **AI Playground.** Pick a model with the **Tools enabled** label, click **Tools > + Add tool**, and select the app.
- **Agents on Databricks.** See [Build an agent with Databricks MCP servers](https://docs.databricks.com/aws/en/generative-ai/mcp/custom-mcp#example-notebooks-build-an-agent-with-databricks-mcp-servers).
- **External MCP clients.** See [Connect to Databricks MCP servers from external clients](https://docs.databricks.com/aws/en/generative-ai/mcp/connect-external-services).

## Tool search

`search_tools` returns the best matches with their input schemas. Its description lists the connected services, so a model knows what it can search for.

| Environment variable | Default | Meaning |
|----------------------|---------|---------|
| `VIRTUAL_MCP_SEARCH_TOP_N` | `5` | Tools returned when the caller doesn't pass `top_n` (at most 25) |
| `EMBEDDING_ENDPOINT` | the `serving-endpoint` resource | Embedding endpoint. Must return 1024-dimension vectors |
| `VIRTUAL_MCP_INDEX_SCHEMA` | `virtual_mcp` | Postgres schema of the index |

If the embedding endpoint fails, tools are indexed and searched by keyword only.

## Running locally

Locally, your Databricks CLI credentials stand in for the signed-in user, so the server listens on `localhost` only and refuses other Host headers. Without Lakebase environment variables, tool search uses the in-memory index.

```bash
uv sync
DATABRICKS_CONFIG_PROFILE=<profile> uv run virtual-mcp-server
```

The explorer is at http://localhost:8000. To test another config without uploading it, put it inline: `VIRTUAL_MCP_CONFIG='{"services": [...]}'`.

## Testing

The tests replace the AI Gateway with an in-memory fake, so they need no workspace:

```bash
uv run pytest
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `No user token` (HTTP 401) | Enable user authorization for Databricks Apps in the workspace, then reopen the app |
| A service shows **error** with `required scopes: ai-gateway` | Add `ai-gateway` to the app's user authorization scopes |
| A service shows **needs sign-in** after signing in | Reload the page. The platform can take a few seconds to store the credential |
| The explorer shows `Config: bundled default` | The volume has no `virtual_mcp_config.json`. Upload it, then restart the app |
| The explorer shows `Config: error loading ...` and no services | The file is invalid or unreadable; the message says which. Fix it or the app's `READ_VOLUME` permission, then restart the app |
| Revoke fails with HTTP 403 | The app lacks the writable `unity-catalog` scope. See [Enable revoke](#4-optional-enable-revoke) |
| `/api/index-status` shows the `memory` backend | Read `backend_error`. Usually pgvector isn't installed; see [Enable pgvector](#2-enable-pgvector) |

Crashes and stack traces go to the app's logs at `https://<app-url>/logz`.
