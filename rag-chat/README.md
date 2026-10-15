# RAG Chat App

Streaming Retrieval-Augmented Generation chat app:

- **pgvector** retrieval over a documents table in Lakebase Postgres.
- **Lakebase**-backed chat history (one row per turn).
- **Model Serving** for chat completion (default `databricks-gpt-5-4-mini`).
- **AI Gateway** for embeddings (default `databricks-gte-large-en`).
- Wikipedia seeding on first startup (configurable via `RAG_RESEED`).

The template is built on [AppKit](https://databricks.github.io/appkit/) with the **Lakebase** and **Server** plugins.

## Prerequisites

- Node.js v22+ and npm
- [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/install) configured with a profile
- Access to Model Serving (chat) and AI Gateway (embeddings) endpoints in your workspace

## One-shot deploy

This template is designed to be scaffolded with `databricks apps init` (not cloned). The commands below take you from zero to a running deployed app.

### 1. Verify Databricks CLI auth

```bash
databricks auth profiles
# If no profile shows Valid: YES:
databricks auth login --profile <profile> --host <workspace-url>
```

Export the profile so subsequent commands pick it up:

```bash
export DATABRICKS_CONFIG_PROFILE=<profile>
```

### 2. Create a Lakebase Postgres project

Pick a short, lowercase ID for the project (e.g. `rag-chat`). `create-project` automatically provisions a default `production` branch plus a default database, so no separate `create-branch` / `create-database` calls are needed:

```bash
PROJECT_ID=rag-chat

databricks postgres create-project "$PROJECT_ID"

BRANCH_NAME="projects/$PROJECT_ID/branches/production"
DATABASE_NAME=$(databricks api get "/api/2.0/postgres/$BRANCH_NAME/databases" -o json | \
  python3 -c "import json,sys; print(json.load(sys.stdin)['databases'][0]['name'])")

echo "Branch:   $BRANCH_NAME"
echo "Database: $DATABASE_NAME"
```

### 3. Scaffold the app from this template

```bash
databricks apps init \
  --name rag-chat-app \
  --template https://github.com/databricks/app-templates/tree/main/rag-chat \
  --set lakebase.postgres.branch="$BRANCH_NAME" \
  --set lakebase.postgres.database="$DATABASE_NAME"

cd rag-chat-app
```

`init` creates the app in the workspace, binds the Lakebase resource, and writes a local `.env` with the resolved connection details.

### 4. Install and deploy

```bash
npm install
npm run deploy
```

`npm run deploy` runs `scripts/sync-bundle-vars.mjs` (which hydrates `.databricks/bundle/default/variable-overrides.json` from the app's bound postgres resource) and then `databricks bundle deploy` followed by `databricks bundle run app`. The final line prints the app URL.

`DATABRICKS_WORKSPACE_ID` and the Lakebase connection variables are auto-injected into the deployed runtime from `app.yaml` and the bound `postgres` resource — no further `.env` work is needed for deploy.

## Develop locally

Local `npm run dev` needs `DATABRICKS_WORKSPACE_ID` (the **numeric** id used to build the AI Gateway URL, `https://<id>.ai-gateway.cloud.databricks.com`) in `.env`. Fetch and patch it:

```bash
WORKSPACE_ID=$(databricks api get /api/2.1/unity-catalog/current-metastore-assignment \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['workspace_id'])")
sed -i.bak "s/^DATABRICKS_WORKSPACE_ID=.*/DATABRICKS_WORKSPACE_ID=$WORKSPACE_ID/" .env && rm .env.bak

npm install
npm run dev
```

Optionally override `DATABRICKS_ENDPOINT` / `DATABRICKS_EMBEDDING_ENDPOINT` in `.env` if you want different chat / embeddings endpoints (also applies to deploy via `app.yaml`).

The first run seeds a handful of Wikipedia articles into the `rag.documents` table. Set `RAG_RESEED=true` in `.env` to re-seed on every restart.

## Project layout

- `client/` — React + Tailwind + shadcn/ui frontend.
- `server/` — Express backend.
  - `server/lib/rag-store.ts` — pgvector schema, similarity search.
  - `server/lib/chat-store.ts` — chat history schema, append/list helpers.
  - `server/lib/embeddings.ts` — AI Gateway embedding call.
  - `server/lib/seed-data.ts` — Wikipedia fetch + chunk + embed.
  - `server/routes/chat-routes.ts` — streaming chat completion with RAG context injection.
  - `server/routes/chat-persistence-routes.ts` — list chats, load chat history.
- `scripts/sync-bundle-vars.mjs` — hydrates bundle variable overrides from the app's postgres resource so `databricks bundle deploy` resolves cleanly.
- `appkit.plugins.json` — AppKit plugin manifest (Lakebase + Server).
- `databricks.yml` — Asset Bundle config.
- `app.yaml` — Databricks App runtime config.

## Related DevHub resources

- [Lakebase Agent Memory](https://dev.databricks.com/templates/lakebase-agent-memory)
- [Streaming AI chat with Model Serving](https://dev.databricks.com/resources/ai-chat-model-serving)
