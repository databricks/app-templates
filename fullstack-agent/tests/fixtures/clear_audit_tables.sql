-- Databricks notebook source
-- Empties the audit and Activity tables for a reset, lifting delta.appendOnly only around each delete.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_ops.action_audit') SET TBLPROPERTIES ('delta.appendOnly' = 'false');
DELETE FROM IDENTIFIER(:project || '_ops.action_audit');
ALTER TABLE IDENTIFIER(:project || '_ops.action_audit') SET TBLPROPERTIES ('delta.appendOnly' = 'true');

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_ops.assistant_activity') SET TBLPROPERTIES ('delta.appendOnly' = 'false');
DELETE FROM IDENTIFIER(:project || '_ops.assistant_activity');
ALTER TABLE IDENTIFIER(:project || '_ops.assistant_activity') SET TBLPROPERTIES ('delta.appendOnly' = 'true');
