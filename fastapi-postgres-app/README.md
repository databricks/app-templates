# Lakebase Autoscaling FastAPI app

A minimal FastAPI app that connects to a Lakebase Autoscaling (Postgres) database. Async stack (SQLAlchemy `AsyncEngine` + `asyncpg`), background OAuth token refresh every 50 minutes, no front-end. Pairs with the [Databricks Apps Cookbook FastAPI + Lakebase recipe](https://apps-cookbook.dev/docs/fastapi/getting_started/lakebase_connection), adapted for Autoscaling.

## Layout

```
fastapi-postgres-app/
├── main.py                   FastAPI entrypoint + lifespan
├── config/database.py        Lakebase connection + token refresh
├── routes/health.py          /healthz, /api/health
├── manifest.yaml             Resource binding (postgres_spec)
├── app.yaml                  Apps deploy config (uvicorn + PGENDPOINT valueFrom)
├── requirements.txt
└── .env.example              Local dev only
```

## Routes

| Method | Path | Description |
|---|---|---|
| GET | `/` | Hello world |
| GET | `/docs` | OpenAPI / Swagger UI |
| GET | `/healthz` | Cheap liveness probe (no DB) |
| GET | `/api/health` | Round-trips to Lakebase |

## Deploy to Databricks Apps

1. **Create the app** in your workspace.
2. **Bind the Lakebase resource.** App → **Settings → Resources → Add resource**:
   - **Database**: pick your Lakebase Autoscaling project, branch, and database
   - **Permission**: `Can connect and create`
   - **Resource key**: `postgres` (must match `valueFrom: postgres` in `app.yaml` — change either side if you prefer a different key)
3. **Deploy** (from a connected Git repo or `databricks apps deploy`).

The resource binding auto-injects `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGSSLMODE` / `PGAPPNAME` and `app.yaml`'s `valueFrom` populates `PGENDPOINT`. Nothing to set manually.

After the app starts, hit `/api/health` to confirm: `{"status": "ok", "database": true}`.

## Testing the API with Postman (service principal auth)

Databricks Apps require an OAuth Bearer token on every request. Easiest way to exercise the API from Postman is with a service principal and Client Credentials grant — Postman fetches and refreshes the token automatically.

### One-time setup

You'll need a workspace admin (or anyone with permission to create service principals) to do this once.

1. **Create a service principal.**
   Workspace → **Settings → Identity and access → Service principals → Add service principal**.

2. **Generate an OAuth client secret.** Open the SP → **Secrets** tab → **Generate secret**. Save both the **client ID** (the SP's application ID) and the **client secret** — the secret is shown only once.

3. **Grant the SP `Can Use` on the app.** Open the app in the workspace → **Permissions** tab → add the service principal with `Can Use`.

### Postman config

In your request, open the **Authorization** tab and configure:

| Field | Value |
|---|---|
| Type | OAuth 2.0 |
| Grant Type | Client Credentials |
| Access Token URL | `https://<your-workspace-host>/oidc/v1/token` |
| Client ID | `<sp-client-id>` |
| Client Secret | `<sp-client-secret>` |
| Scope | `all-apis` |
| Client Authentication | Send as Basic Auth header |

Your **workspace host** is what's in the browser address bar when you're logged into Databricks (everything between `https://` and the first slash). It's **not** the app URL — the token endpoint lives on the workspace itself.

Click **Get New Access Token**, then the orange **Use Token** button. Postman fetches a JWT (starts with `ey...`) and applies it as a Bearer token. Tokens last about an hour; Postman re-fetches as needed.

Point the request at your app's public URL, e.g. `GET https://<app-name>-<workspace-id>.cloud.databricksapps.com/api/health`.

## Local dev

```bash
cp .env.example .env
# fill in the TODOs (see comments in .env.example)
uv pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Local dev requires your identity to be registered as a Lakebase role on the target project (one-time; the deployed app's SP gets auto-registered by the resource binding):

```sql
CREATE EXTENSION IF NOT EXISTS databricks_auth;
SELECT databricks_create_role('you@domain.com', 'USER');
```

## Caveats

- **Token lifecycle.** Lakebase OAuth tokens live ~60 min. The background task refreshes every 50.
- **SSL required.** Hardcoded in `connect_args`.
- **Resource key must match `valueFrom`.** `app.yaml` references `valueFrom: postgres`. If you use a different key in the UI, change either side to match.

## What this example doesn't show

Kept intentionally minimal. Not included:
- Front-end UI
- Routes that query application tables (bring your own)
- Write operations (INSERT/UPDATE/DELETE)
- User-authorized queries (connects as the app SP, not the end user)
- Migrations / Alembic
