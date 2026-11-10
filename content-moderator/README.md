# Content Moderator

Content moderation with per-target guidelines, AI compliance scoring, and Lakebase + Genie.

## Provisioning

Manual: Lakebase, SQL Warehouse, Genie space over `content_moderation` tables.

**SQL:** `provisioning/sql/00_no_unity_catalog_ddl.sql` — no UC baseline required. The app's
service principal creates and seeds the `content_moderation` schema (guidelines,
submissions, reviews) on first startup, so no manual seeding is needed.

AI compliance scoring calls the workspace's built-in Foundation Model API endpoint
(`databricks-gpt-5-4-mini`) via the app service principal — no extra setup required.

## Setup

Edit `databricks.yml` (REPLACE_ME). Then:

```bash
npm install
npm run build
databricks bundle deploy --profile <PROFILE>
```

On first startup the app seeds demo data into Lakebase as the app service principal
(which owns the schema), so the OLTP/CRUD path works without any human pre-seed.

```bash
databricks apps init \
  --template https://github.com/databricks/app-templates/tree/main/content-moderator \
  --name content-moderator
```

## Analytics dashboard (optional)

The dashboard reads Lakebase data from the SQL Warehouse through a Unity Catalog catalog.

> ⚠️ **The catalog name is load-bearing.** The analytics queries in `config/queries/*.sql`
> hardcode the literal `content_moderation.content_moderation.<table>` (`<catalog>.<schema>.<table>`),
> and build-time type generation (`prebuild` runs `appkit generate-types --wait`) `DESCRIBE`s
> them as the app service principal. You must register the catalog with the **exact name
> `content_moderation`** and grant the SP access **before the next build/deploy** — otherwise
> typegen can't resolve the columns, emits empty types, and the client build fails. If you prefer
> a different catalog name, change the three-part names in `config/queries/*.sql` to match.

After the first deploy (which creates the app and its service principal), register the
Lakebase database as a catalog **named `content_moderation`**:

```bash
databricks postgres create-catalog content_moderation \
  --json '{"spec":{"postgres_database":"databricks_postgres","branch":"projects/<project>/branches/<branch>"}}'
```

Then grant the app service principal read access (build-time type generation runs the
analytics queries as the SP, so grant before the next build/deploy). Get the SP id with
`databricks apps get content-moderator -o json | jq -r .service_principal_client_id`, then
run on the warehouse:

```sql
GRANT USE CATALOG ON CATALOG content_moderation TO `<sp-client-id>`;
GRANT USE SCHEMA ON SCHEMA content_moderation.content_moderation TO `<sp-client-id>`;
GRANT SELECT ON SCHEMA content_moderation.content_moderation TO `<sp-client-id>`;
```
