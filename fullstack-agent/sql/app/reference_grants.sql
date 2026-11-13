-- Databricks notebook source
-- Grants the agent app identity SELECT on the products reference table.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

BEGIN
  FOR app AS SELECT :agent_application_id AS principal DO
    EXECUTE IMMEDIATE 'GRANT SELECT ON TABLE ' || :project || '_reference.products TO `' || app.principal || '`';
  END FOR;
END;
