-- Databricks notebook source
-- Sets the own_rows_or_backoffice row filter on the owner_email column of each use-case table.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

USE SCHEMA IDENTIFIER(:project || '_ops');

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_data.customers') SET ROW FILTER own_rows_or_backoffice ON (owner_email);

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_data.accounts') SET ROW FILTER own_rows_or_backoffice ON (owner_email);

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_data.transactions') SET ROW FILTER own_rows_or_backoffice ON (owner_email);

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_data.disputes') SET ROW FILTER own_rows_or_backoffice ON (owner_email);
