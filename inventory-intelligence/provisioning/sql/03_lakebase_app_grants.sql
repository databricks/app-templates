-- Inventory Intelligence — Lakebase App Grants
--
-- Run this after deploying the app for the first time (or after the app is recreated).
-- The app service principal must connect at least once before its Postgres role exists.
--
-- Find the service principal UUID:
--   databricks apps get inventory-intelligence --output json | python3 -c \
--     "import json,sys; print(json.load(sys.stdin)['service_principal_client_id'])"
--
-- Connect with psql or the Databricks Postgres CLI, then run:
--   \set sp '<service-principal-uuid>'

GRANT USAGE ON SCHEMA inventory TO :"sp";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO :"sp";
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"sp";

GRANT USAGE ON SCHEMA gold TO :"sp";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gold TO :"sp";
ALTER DEFAULT PRIVILEGES IN SCHEMA gold
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"sp";
