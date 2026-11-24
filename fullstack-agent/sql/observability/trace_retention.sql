-- Databricks notebook source
-- Deletes the erased user's trace rows and Apps auth events (enduser.id), and every row older than retention_days, from one set of OpenTelemetry tables (table_prefix), then vacuums them.
USE CATALOG IDENTIFIER(:catalog);

-- COMMAND ----------

USE SCHEMA IDENTIFIER(:schema);

-- COMMAND ----------

DELETE FROM IDENTIFIER(:table_prefix || '_otel_annotations')
WHERE target_type = 'TRACE'
  AND target_id IN (
    SELECT trace_id FROM IDENTIFIER(:table_prefix || '_otel_spans')
    WHERE attributes:['user.id']::string = :erased_user
  );

-- COMMAND ----------

DELETE FROM IDENTIFIER(:table_prefix || '_otel_logs')
WHERE trace_id IN (
  SELECT trace_id FROM IDENTIFIER(:table_prefix || '_otel_spans')
  WHERE attributes:['user.id']::string = :erased_user
);

-- COMMAND ----------

DELETE FROM IDENTIFIER(:table_prefix || '_otel_logs')
WHERE attributes:['enduser.id']::string = :erased_user;

-- COMMAND ----------

DELETE FROM IDENTIFIER(:table_prefix || '_otel_spans')
WHERE trace_id IN (
  SELECT trace_id FROM IDENTIFIER(:table_prefix || '_otel_spans')
  WHERE attributes:['user.id']::string = :erased_user
);

-- COMMAND ----------

DELETE FROM IDENTIFIER(:table_prefix || '_otel_annotations')
WHERE created_at < timestampadd(DAY, -CAST(:retention_days AS INT), current_timestamp());

-- COMMAND ----------

DELETE FROM IDENTIFIER(:table_prefix || '_otel_logs')
WHERE `time` < timestampadd(DAY, -CAST(:retention_days AS INT), current_timestamp());

-- COMMAND ----------

DELETE FROM IDENTIFIER(:table_prefix || '_otel_metrics')
WHERE `time` < timestampadd(DAY, -CAST(:retention_days AS INT), current_timestamp());

-- COMMAND ----------

DELETE FROM IDENTIFIER(:table_prefix || '_otel_spans')
WHERE `time` < timestampadd(DAY, -CAST(:retention_days AS INT), current_timestamp());

-- COMMAND ----------

VACUUM IDENTIFIER(:table_prefix || '_otel_annotations');

-- COMMAND ----------

VACUUM IDENTIFIER(:table_prefix || '_otel_logs');

-- COMMAND ----------

VACUUM IDENTIFIER(:table_prefix || '_otel_metrics');

-- COMMAND ----------

VACUUM IDENTIFIER(:table_prefix || '_otel_spans');
