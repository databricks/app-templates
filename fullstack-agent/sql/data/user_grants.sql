-- Databricks notebook source
-- Grants the app users group SELECT on the use-case tables and EXECUTE on the write procedures, never MODIFY.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

BEGIN
  EXECUTE IMMEDIATE 'GRANT SELECT ON TABLE ' || :project || '_data.customers TO `' || :app_users_group || '`';
  EXECUTE IMMEDIATE 'GRANT SELECT ON TABLE ' || :project || '_data.accounts TO `' || :app_users_group || '`';
  EXECUTE IMMEDIATE 'GRANT SELECT ON TABLE ' || :project || '_data.transactions TO `' || :app_users_group || '`';
  EXECUTE IMMEDIATE 'GRANT SELECT ON TABLE ' || :project || '_data.disputes TO `' || :app_users_group || '`';
  EXECUTE IMMEDIATE 'GRANT EXECUTE ON PROCEDURE ' || :project || '_ops.file_dispute TO `' || :app_users_group || '`';
  EXECUTE IMMEDIATE 'GRANT EXECUTE ON PROCEDURE ' || :project || '_ops.transfer_between_own_accounts TO `' || :app_users_group || '`';
  EXECUTE IMMEDIATE 'GRANT EXECUTE ON PROCEDURE ' || :project || '_ops.update_contact_details TO `' || :app_users_group || '`';
END;
