-- Databricks notebook source
-- Grants the agent app identity SELECT on the audit table, and SELECT and MODIFY on the Activity table, its only write.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

BEGIN
  FOR app AS SELECT :agent_application_id AS principal DO
    EXECUTE IMMEDIATE 'GRANT SELECT ON TABLE ' || :project || '_ops.action_audit TO `' || app.principal || '`';
    EXECUTE IMMEDIATE 'GRANT SELECT, MODIFY ON TABLE ' || :project || '_ops.assistant_activity TO `' || app.principal || '`';
  END FOR;
END;
