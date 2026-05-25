-- PostgreSQL (Lakebase) — run against the same database you use for the demo OLTP schema.
--
-- Lakehouse Sync CDC requires REPLICA IDENTITY FULL on replicated tables so updates/deletes
-- carry enough column data. Tables without this may be skipped with a warning.
--
-- Prerequisites:
--   - Tables must already exist (e.g. after running seed/seed.ts).
--   - Idempotent: safe to re-run.
--
-- Connect with psql or your client using credentials from:
--   databricks postgres generate-database-credential <endpoint-resource-name>

ALTER TABLE public.users REPLICA IDENTITY FULL;
ALTER TABLE public.admins REPLICA IDENTITY FULL;
ALTER TABLE public.menu_items REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;
ALTER TABLE public.support_cases REPLICA IDENTITY FULL;
ALTER TABLE public.support_messages REPLICA IDENTITY FULL;
ALTER TABLE public.refunds REPLICA IDENTITY FULL;
ALTER TABLE public.credits REPLICA IDENTITY FULL;
