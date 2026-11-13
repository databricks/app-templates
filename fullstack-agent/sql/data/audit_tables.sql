-- Databricks notebook source
-- Creates the append-only audit and Activity tables and the own_rows_or_backoffice row filter, sets NOT NULL on an existing audit table's core columns when none holds a NULL, sets the filter on both, and grants the app users group SELECT on both.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER(:project || '_ops.action_audit') (
  audit_id STRING NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  action STRING NOT NULL,
  actor STRING NOT NULL,
  target_ids ARRAY<STRING>,
  amount DECIMAL(12, 2),
  outcome STRING NOT NULL,
  reason STRING,
  idempotency_key STRING
)
CLUSTER BY (actor, idempotency_key)
TBLPROPERTIES ('delta.feature.catalogManaged' = 'supported');

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_ops.action_audit') SET TBLPROPERTIES ('delta.appendOnly' = 'true');

-- COMMAND ----------

BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = :project || '_ops' AND table_name = 'action_audit'
      AND column_name IN ('occurred_at', 'action', 'actor', 'outcome') AND is_nullable = 'YES'
  ) AND NOT EXISTS (
    SELECT 1 FROM IDENTIFIER(:project || '_ops.action_audit')
    WHERE occurred_at IS NULL OR action IS NULL OR actor IS NULL OR outcome IS NULL
  ) THEN
    ALTER TABLE IDENTIFIER(:project || '_ops.action_audit') ALTER COLUMN
      occurred_at SET NOT NULL, action SET NOT NULL, actor SET NOT NULL, outcome SET NOT NULL;
  END IF;
END;

-- COMMAND ----------

CREATE TABLE IF NOT EXISTS IDENTIFIER(:project || '_ops.assistant_activity') (
  activity_id STRING NOT NULL,
  owner_email STRING NOT NULL,
  session_id STRING,
  run_id STRING,
  at TIMESTAMP,
  tool STRING,
  identity STRING,
  target STRING,
  outcome STRING,
  status STRING,
  reference STRING,
  proposal_id STRING
)
CLUSTER BY (owner_email, at)
TBLPROPERTIES ('delta.feature.catalogManaged' = 'supported');

-- COMMAND ----------

ALTER TABLE IDENTIFIER(:project || '_ops.assistant_activity') SET TBLPROPERTIES ('delta.appendOnly' = 'true');

-- COMMAND ----------

USE SCHEMA IDENTIFIER(:project || '_ops');

-- COMMAND ----------

EXECUTE IMMEDIATE
  "CREATE OR REPLACE FUNCTION " || :project || "_ops.own_rows_or_backoffice(owner_email STRING) "
  || "RETURNS BOOLEAN "
  || "COMMENT 'True for rows the caller owns, or for every row when the caller is in the back-office group.' "
  || "RETURN owner_email = session_user() OR is_account_group_member('" || :backoffice_group || "')";

-- COMMAND ----------

ALTER TABLE action_audit SET ROW FILTER own_rows_or_backoffice ON (actor);

-- COMMAND ----------

ALTER TABLE assistant_activity SET ROW FILTER own_rows_or_backoffice ON (owner_email);

-- COMMAND ----------

BEGIN
  EXECUTE IMMEDIATE 'GRANT SELECT ON TABLE ' || :project || '_ops.action_audit TO `' || :app_users_group || '`';
  EXECUTE IMMEDIATE 'GRANT SELECT ON TABLE ' || :project || '_ops.assistant_activity TO `' || :app_users_group || '`';
END;
