-- Inventory Intelligence — Unity Catalog Schemas
--
-- Replace __CATALOG_NAME__ with your Unity Catalog catalog name before running.
-- Run this in a SQL Warehouse after creating the catalog.

USE CATALOG __CATALOG_NAME__;

CREATE SCHEMA IF NOT EXISTS lakebase
  COMMENT 'Bronze CDC history tables from Lakehouse Sync';

CREATE SCHEMA IF NOT EXISTS silver
  COMMENT 'Current-state silver tables from the Lakeflow Declarative Pipeline';

CREATE SCHEMA IF NOT EXISTS gold
  COMMENT 'Analytics materialized views and forecast output';
