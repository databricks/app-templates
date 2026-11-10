-- Unity Catalog baseline for the Agentic Support Console example.
--
-- Prerequisites:
--   - Replace __CATALOG_NAME__ with your target catalog (e.g. my_demo_catalog).
--   - The catalog must already exist and your principal must have permission to create schemas.
--
-- This file is safe to re-run: CREATE SCHEMA IF NOT EXISTS

CREATE SCHEMA IF NOT EXISTS __CATALOG_NAME__.lakebase
  COMMENT 'Bronze: Lakehouse Sync CDC history (lb_*_history tables)';

CREATE SCHEMA IF NOT EXISTS __CATALOG_NAME__.silver
  COMMENT 'Silver: current-state SCD Type 1 tables';

CREATE SCHEMA IF NOT EXISTS __CATALOG_NAME__.gold
  COMMENT 'Gold: analytical materialized views and agent output tables';
