# Inventory Intelligence

An end-to-end retail inventory management app on Databricks: Lakebase (OLTP), Lakehouse Sync (CDC), Lakeflow Declarative Pipelines (silver/gold medallion), a pluggable demand forecast Lakeflow Job, Sync Tables (reverse ETL), and a Databricks App with Genie analytics.

## Architecture

```
OLTP (Lakebase Postgres)
    │  Lakehouse Sync (CDC)
    ▼
Bronze (lakebase.lb_*_history)
    │  Lakeflow Declarative Pipeline
    ▼
Silver (current-state SCD Type 1 tables)
    │  Materialized Views
    ▼
Gold (inventory_overview, low_stock_alerts, sales_velocity)
    │  Lakeflow Job (pluggable demand forecast model)
    ▼
gold.replenishment_recommendations (Delta)
    │  Sync Tables (reverse ETL)
    ▼
Lakebase (*_sync tables)
    ▼
Inventory Intelligence App (Databricks App)
```

## Components

- **`client/`, `server/`, `config/queries/`** — AppKit app (Dashboard, Stores, Replenishment, Analytics/Genie).
- **`pipelines/inventory_analytics/`** — Lakeflow Declarative Pipeline (silver + gold layers).
- **`pipelines/demand_forecast/`** — Lakeflow Job with pluggable model (`weighted_moving_average`, `exponential_smoothing`, `prophet`, `model_serving`).
- **`seed/`** — TypeScript seed for Lakebase OLTP data (5 stores, 25 products, 90 days of history).
- **`provisioning/sql/`** — Idempotent SQL scripts (Unity Catalog schemas, Postgres REPLICA IDENTITY FULL).

## Prerequisites

- Databricks CLI (`databricks auth login --profile <profile>`)
- Unity Catalog catalog with appropriate grants
- A SQL Warehouse
- Lakebase Postgres project + branch + database ([create via CLI](#1-create-lakebase))

## Deployment

### Quick deploy

```bash
# 1. Fill in databricks.yml (workspace host, sql_warehouse_id, postgres_* values)
# 2. Run the deploy script
./deploy.sh --profile <profile>
```

The script handles: `npm install`, `npm run build`, `databricks bundle deploy`, database seeding, and `databricks apps deploy`.

### Manual step-by-step

#### 1. Create Lakebase

```bash
# Create project (takes ~5 min to provision)
databricks postgres create-project inventory-intelligence \
  --no-wait --profile <profile>

# Wait for READY state
databricks postgres list-projects --profile <profile> --output json

# Get branch, database, endpoint details
databricks postgres list-branches projects/inventory-intelligence --profile <profile> --output json
databricks postgres list-databases projects/inventory-intelligence/branches/production --profile <profile> --output json
databricks postgres list-endpoints projects/inventory-intelligence/branches/production --profile <profile> --output json
```

#### 2. Configure `databricks.yml`

Update the `default` target in `databricks.yml`:

```yaml
targets:
  default:
    workspace:
      host: https://my-workspace.cloud.databricks.com
    variables:
      sql_warehouse_id: <warehouse-id>
      postgres_branch: projects/inventory-intelligence/branches/production
      postgres_database: projects/inventory-intelligence/branches/production/databases/db-xxxx
      genie_space_id: REPLACE_ME # optional — see step 7
```

#### 3. Install, build, and bundle deploy

```bash
npm install
npm run build
databricks bundle deploy --profile <profile>
```

`databricks bundle deploy` creates the Databricks App resource and uploads source files to the workspace.

#### 4. Seed Lakebase

```bash
cd seed && npm install

# Get a short-lived Postgres credential
WORKSPACE_TOKEN=$(databricks auth token --profile <profile> -o json | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
PG_PASS=$(curl -sS -X POST "https://<workspace>/api/2.0/postgres/credentials" \
  -H "Authorization: Bearer $WORKSPACE_TOKEN" -H "Content-Type: application/json" \
  -d '{"endpoint":"projects/inventory-intelligence/branches/production/endpoints/primary"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")

DATABASE_URL="postgresql://<your-email>:<PG_PASS>@<pg-host>:5432/databricks_postgres?sslmode=require" \
  npm run seed

cd ..
```

#### 5. Configure Lakehouse Sync (UI)

In the Databricks UI, configure **Lakehouse Sync** to replicate the Lakebase `inventory` schema to Unity Catalog:

| Source (Lakebase)              | Target (Unity Catalog)                             |
| ------------------------------ | -------------------------------------------------- |
| `inventory.stores`             | `<catalog>.lakebase.lb_stores_history`             |
| `inventory.products`           | `<catalog>.lakebase.lb_products_history`           |
| `inventory.stock_levels`       | `<catalog>.lakebase.lb_stock_levels_history`       |
| `inventory.sales_transactions` | `<catalog>.lakebase.lb_sales_transactions_history` |

Run `provisioning/sql/01_unity_catalog_schemas.sql` first to create the schemas.

#### 6. Deploy analytics pipeline

```bash
cd pipelines/inventory_analytics
# Edit databricks.yml: set workspace host and catalog name
databricks bundle deploy --profile <profile>
cd ../..
```

This creates the silver + gold Delta tables in Unity Catalog.

#### 7. Deploy demand forecast job

```bash
cd pipelines/demand_forecast
# Edit databricks.yml: set workspace host, catalog, and forecast_model variable
databricks bundle deploy --profile <profile>
databricks bundle run demand_forecast_job --profile <profile>
cd ../..
```

**Forecast models** — set `forecast_model` in the job's `databricks.yml`:

| Value                     | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `weighted_moving_average` | Simple weighted average of recent sales (default, no dependencies) |
| `exponential_smoothing`   | Holt-Winters exponential smoothing via `statsmodels`               |
| `prophet`                 | Facebook Prophet for seasonality-aware forecasting                 |
| `model_serving`           | Call a registered MLflow model via AI Gateway                      |

#### 8. Configure Sync Tables (UI)

In the Databricks UI, configure **Sync Tables** to reverse-sync from Delta gold back to Lakebase:

| Source (Delta)                                 | Target (Lakebase)                         | Mode     |
| ---------------------------------------------- | ----------------------------------------- | -------- |
| `<catalog>.gold.replenishment_recommendations` | `gold.replenishment_recommendations_sync` | SNAPSHOT |
| `<catalog>.gold.inventory_overview`            | `gold.inventory_overview_sync`            | SNAPSHOT |
| `<catalog>.gold.low_stock_alerts`              | `gold.low_stock_alerts_sync`              | SNAPSHOT |

#### 9. Deploy app source code

```bash
# Start app compute (if stopped)
databricks apps start inventory-intelligence --profile <profile>

# Deploy source code
databricks apps deploy inventory-intelligence \
  --source-code-path /Workspace/Users/<you>/.bundle/inventory-intelligence/default/files \
  --profile <profile>
```

#### 10. (Optional) Add Genie Space

1. In the Databricks UI, create a **Genie Space** pointed at `<catalog>.gold.inventory_overview`, `low_stock_alerts`, and `sales_velocity`.
2. Copy the space ID from the URL.
3. Update `databricks.yml`: `genie_space_id: <space-id>`
4. Re-run `./deploy.sh --profile <profile>` — the Analytics tab will activate.

## Tech stack

AppKit (Express + React 19), Lakebase Postgres, Unity Catalog, Lakeflow Declarative Pipelines, Lakeflow Jobs, Sync Tables, Databricks Asset Bundles.

## Deployment notes

### Why two deploy commands?

`databricks bundle deploy` creates the **app resource** in Databricks and uploads source files to the workspace. `databricks apps deploy` triggers the **app server** to pull the latest source code and restart. Both are needed.

### Why build is split between local and server

`databricks.yml` uses `sync.include` to upload `dist/**` (the tsdown-built server bundle — ~500 bytes). The app server detects `dist/server.js` and skips re-running tsdown, then only runs vite for the client build (~20s). This avoids uploading the 2MB browser JS bundle through the workspace API, which takes longer than just letting vite run on the app server.

Run `npm run build:server` before `databricks bundle deploy` to keep the server bundle fresh.

### Build scripts and `$PATH`

Build scripts use `node ./node_modules/.bin/appkit` (not bare `appkit`) so they work in the app server's shell environment where `node_modules/.bin` may not be in `$PATH`.

### What DAB handles vs what needs the CLI

| Task                      | Tool                                                 |
| ------------------------- | ---------------------------------------------------- |
| App resource + config     | `databricks bundle deploy`                           |
| Source code deployment    | `databricks apps deploy`                             |
| Analytics pipeline        | `databricks bundle deploy` (in `pipelines/`)         |
| Forecast job              | `databricks bundle deploy` + `run` (in `pipelines/`) |
| Lakebase project creation | CLI only (no DAB resource yet)                       |
| Database seeding          | CLI + `seed/seed.ts`                                 |
| Lakehouse Sync            | UI only                                              |
| Sync Tables               | UI only                                              |
| Genie Space creation      | UI only                                              |
