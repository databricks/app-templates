# Content Moderator

Content moderation with per-target guidelines, optional AI scoring, and Lakebase + Genie.

## Provisioning

Manual: Lakebase, SQL Warehouse, optional Model Serving endpoint, Genie over `content_moderation` tables.

**SQL:** `provisioning/sql/00_no_unity_catalog_ddl.sql` — no UC baseline required; see README for steps.

## Setup

Edit `databricks.yml` (REPLACE_ME). Then:

```bash
cd seed
npm install
DATABASE_URL="postgresql://..." npm run seed
```

```bash
cd ..
npm install
npm run build
databricks bundle deploy --profile <PROFILE>
```

```bash
databricks apps init \
  --template https://github.com/databricks/devhub/tree/main/examples/content-moderator \
  --name content-moderator
```
