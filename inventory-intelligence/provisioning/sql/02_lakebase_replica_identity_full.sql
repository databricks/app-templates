-- Inventory Intelligence — Lakebase REPLICA IDENTITY FULL
--
-- Run this on the Lakebase Postgres database (not in a SQL Warehouse).
-- Required for Lakehouse Sync (CDC) to capture full row images on UPDATE and DELETE.
-- Connect with: psql "postgresql://<host>:<port>/<db>?sslmode=require"

ALTER TABLE inventory.stores REPLICA IDENTITY FULL;
ALTER TABLE inventory.products REPLICA IDENTITY FULL;
ALTER TABLE inventory.stock_levels REPLICA IDENTITY FULL;
ALTER TABLE inventory.sales_transactions REPLICA IDENTITY FULL;
ALTER TABLE inventory.replenishment_orders REPLICA IDENTITY FULL;
