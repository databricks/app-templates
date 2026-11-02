-- Databricks notebook source
-- Creates the national ID and fraud score masks and sets them, so only the back-office group sees the full values.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

USE SCHEMA IDENTIFIER(:project || '_ops');

-- COMMAND ----------

EXECUTE IMMEDIATE
  "CREATE OR REPLACE FUNCTION " || :project || "_ops.mask_national_id(national_id STRING) "
  || "RETURNS STRING "
  || "COMMENT 'Shows only the last 4 characters unless the caller is in the back-office group.' "
  || "RETURN CASE WHEN is_account_group_member('" || :backoffice_group || "') THEN national_id "
  || "ELSE concat(repeat('*', greatest(length(national_id) - 4, 0)), right(national_id, 4)) END";

-- COMMAND ----------

EXECUTE IMMEDIATE
  "CREATE OR REPLACE FUNCTION " || :project || "_ops.mask_internal_score(fraud_score DOUBLE) "
  || "RETURNS DOUBLE "
  || "COMMENT 'Hides the internal fraud score unless the caller is in the back-office group.' "
  || "RETURN CASE WHEN is_account_group_member('" || :backoffice_group || "') THEN fraud_score END";

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_data.customers') ALTER COLUMN national_id SET MASK mask_national_id;

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_data.transactions') ALTER COLUMN fraud_score SET MASK mask_internal_score;
