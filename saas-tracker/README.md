# SaaS Subscription Tracker

Internal tool for tracking SaaS subscriptions, costs, and renewals with Lakebase and Genie.

## Architecture

Lakebase (`saas_tracker.subscriptions`) to the Databricks App (dashboard, CRUD, analytics).

## Components

- App under `client/`, `server/`, `config/queries/`.
- **`seed/`** — Demo subscriptions.

## Provisioning

Manual: create Lakebase project/branch/database, SQL Warehouse ID, Genie space over `saas_tracker.subscriptions`.

**SQL:** `provisioning/sql/00_no_unity_catalog_ddl.sql` documents that no UC DDL is required; schema comes from app/seed.

## Setup

```bash
cd seed
npm install
DATABASE_URL="postgresql://..." npm run seed
```

Edit `databricks.yml` (REPLACE_ME), then from `template/`:

```bash
npm install
npm run build
databricks bundle deploy --profile <PROFILE>
```

```bash
databricks apps init \
  --template https://github.com/databricks/devhub/tree/main/examples/saas-tracker \
  --name saas-tracker
```
