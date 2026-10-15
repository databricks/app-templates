# SaaS Subscription Tracker

Internal tool for tracking SaaS subscriptions, costs, and renewals with Lakebase and Genie.

## Architecture

Lakebase (`saas_tracker.subscriptions`) to the Databricks App (dashboard, CRUD, analytics).

## Components

- App under `client/`, `server/`, `config/queries/`.
- Demo subscriptions are seeded on first startup by the app (see `server/lib/seed-data.ts`).

## Provisioning

Manual: create Lakebase project/branch/database, SQL Warehouse ID, Genie space over `saas_tracker.subscriptions`.

**SQL:** `provisioning/sql/00_no_unity_catalog_ddl.sql` documents that no UC DDL is required;
the `saas_tracker` schema, table, and demo rows are created on first startup by the app
service principal (which owns them).

## Setup

Edit `databricks.yml` (REPLACE_ME), then:

```bash
npm install
npm run build
databricks bundle deploy --profile <PROFILE>
```

On first startup the app seeds demo subscriptions into Lakebase as the app service
principal (which owns the schema), so the OLTP/CRUD path works without any human pre-seed.

```bash
databricks apps init \
  --template https://github.com/databricks/app-templates/tree/main/saas-tracker \
  --name saas-tracker
```

## Analytics dashboard (optional)

The dashboard reads Lakebase data from the SQL Warehouse through a Unity Catalog catalog.

> ⚠️ **The catalog name is load-bearing.** The analytics queries in `config/queries/*.sql`
> hardcode the literal `saas_tracker.saas_tracker.subscriptions` (`<catalog>.<schema>.<table>`),
> and build-time type generation (`prebuild` runs `appkit generate-types --wait`) `DESCRIBE`s
> them as the app service principal. You must register the catalog with the **exact name
> `saas_tracker`** and grant the SP access **before the next build/deploy** — otherwise typegen
> can't resolve the columns, emits empty types, and the client build fails. If you prefer a
> different catalog name, change the three-part names in `config/queries/*.sql` to match.

After the first deploy (which creates the app and its service principal), register the
Lakebase database as a catalog **named `saas_tracker`**:

```bash
databricks postgres create-catalog saas_tracker \
  --json '{"spec":{"postgres_database":"databricks_postgres","branch":"projects/<project>/branches/<branch>"}}'
```

Then grant the app service principal read access (build-time type generation runs the
analytics queries as the SP, so grant before the next build/deploy). Get the SP id with
`databricks apps get saas-tracker -o json | jq -r .service_principal_client_id`, then run
on the warehouse:

```sql
GRANT USE CATALOG ON CATALOG saas_tracker TO `<sp-client-id>`;
GRANT USE SCHEMA ON SCHEMA saas_tracker.saas_tracker TO `<sp-client-id>`;
GRANT SELECT ON SCHEMA saas_tracker.saas_tracker TO `<sp-client-id>`;
```
