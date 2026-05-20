# Agentic Support Console

An end-to-end example of an AI-powered support console built on the Databricks platform: Lakebase (OLTP), Lakehouse Sync (CDC), Lakeflow Declarative Pipelines (medallion), a Lakeflow Job (AI agent), reverse sync, and a Databricks App with Genie analytics.

## Architecture

```
OLTP (Lakebase Postgres)
    |  Lakehouse Sync (CDC)
    v
Bronze (lakebase.lb_*_history)
    |  Lakeflow Declarative Pipeline
    v
Silver (current-state SCD Type 1 tables)
    |  Materialized Views
    v
Gold (analytics + support context)
    |  Lakeflow Job (LLM via AI Gateway)
    v
gold.support_agent_responses (Delta)
    |  Reverse Sync (Sync Tables)
    v
Lakebase (gold.*_sync tables)
    v
Support Console (Databricks App)
```

## Components

- **`client/`, `server/`, `config/queries/`** — AppKit app (Cases, Case Detail, Analytics).
- **`pipelines/support_analytics/`** — Medallion Lakeflow Declarative Pipeline (silver + gold).
- **`pipelines/support_agent/`** — Lakeflow Job calling an LLM via AI Gateway.
- **`seed/`** — TypeScript seed for Lakebase OLTP data.
- **`provisioning/sql/`** — Optional baseline SQL (Unity Catalog schemas, Postgres `REPLICA IDENTITY FULL`).

## Prerequisites

- Databricks CLI with a workspace profile
- Lakebase Postgres project, branch, database
- Unity Catalog catalog (with grants)
- SQL Warehouse
- Genie Space (analytics tab)

## Provisioning

Optional scripts in `provisioning/sql/` are idempotent where noted. Skip if you reuse an existing catalog and sync.

| Step | What                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Catalog** — Must exist (often UI or CLI with storage root).                                                                                             |
| 2    | **UC schemas** — Run `provisioning/sql/01_unity_catalog_schemas.sql` in a SQL warehouse after replacing `__CATALOG_NAME__`.                               |
| 3    | **Lakebase** — Create tables via `seed/`; seed sets `REPLICA IDENTITY FULL`, or run `provisioning/sql/02_lakebase_replica_identity_full.sql` on Postgres. |
| 4    | **Lakehouse Sync** — UI: replicate Lakebase `public` to UC `lakebase.lb_*_history`.                                                                       |
| 5    | **Bundles** — Deploy `pipelines/support_analytics`, `pipelines/support_agent`, then this app (see below).                                                 |
| 6    | **Reverse sync** — UI: Sync Tables from gold Delta to Lakebase `gold.*_sync` (see table below).                                                           |
| 7    | **Genie** — UI: create space, wire `genie_space_id` in the app bundle.                                                                                    |

### Reverse sync (Sync Tables)

| Source                         | Target                              | Mode       |
| ------------------------------ | ----------------------------------- | ---------- |
| `gold.support_agent_responses` | `gold.support_agent_responses_sync` | CONTINUOUS |
| `gold.support_case_context`    | `gold.support_case_context_sync`    | SNAPSHOT   |
| `gold.user_support_profile`    | `gold.user_support_profile_sync`    | SNAPSHOT   |
| `gold.support_overview`        | `gold.support_overview_sync`        | SNAPSHOT   |

## Setup (order)

### 1. Seed data

```bash
cd seed
npm install
DATABASE_URL="postgresql://..." npm run seed
```

### 2. Lakehouse Sync

Configure in the UI from Lakebase `public` to Unity Catalog (bronze history tables).

### 3. Deploy medallion pipeline

```bash
cd pipelines/support_analytics
# Set workspace host and catalog in databricks.yml
databricks bundle deploy --target dev
```

### 4. Deploy support agent job

```bash
cd pipelines/support_agent
databricks bundle deploy --target dev
```

### 5. Reverse sync

Configure Sync Tables per the table above (UI).

### 6. Deploy app

From this `template/` directory:

```bash
npm install
databricks bundle deploy
```

### Optional: CLI scaffold

```bash
databricks apps init \
  --template https://github.com/databricks/devhub/tree/main/examples/agentic-support-console \
  --name support-console
```

## Tech stack

AppKit (Express + React 19), Lakebase, Unity Catalog, Lakeflow Pipelines/Jobs, AI Gateway, Databricks Asset Bundles.
