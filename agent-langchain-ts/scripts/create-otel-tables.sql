-- Create Unity Catalog tables for OpenTelemetry trace storage
-- Run this in Databricks SQL workspace or via databricks CLI

-- Step 1: Create schema (if not already created)
-- This was already done via CLI: main.agent_traces

-- Step 2: Create the otel_spans table
CREATE TABLE IF NOT EXISTS main.agent_traces.otel_spans (
  trace_id STRING COMMENT 'Unique identifier for the trace',
  span_id STRING COMMENT 'Unique identifier for the span',
  parent_span_id STRING COMMENT 'Parent span ID (null for root spans)',
  name STRING COMMENT 'Span name (e.g., "LLMChain.run", "ChatModel.generate")',
  kind STRING COMMENT 'Span kind (CLIENT, SERVER, INTERNAL, etc.)',
  start_time TIMESTAMP COMMENT 'Span start timestamp',
  end_time TIMESTAMP COMMENT 'Span end timestamp',
  attributes MAP<STRING, STRING> COMMENT 'Span attributes (key-value pairs)',
  events ARRAY<STRUCT<
    timestamp: TIMESTAMP,
    name: STRING,
    attributes: MAP<STRING, STRING>
  >> COMMENT 'Span events (logs within the span)',
  status_code STRING COMMENT 'Span status (OK, ERROR, etc.)',
  status_message STRING COMMENT 'Status message (error details if failed)',
  resource_attributes MAP<STRING, STRING> COMMENT 'Resource attributes (service name, etc.)'
)
USING DELTA
COMMENT 'OpenTelemetry traces from LangChain agents';

-- Step 3: Grant permissions
GRANT USE_CATALOG ON CATALOG main TO `sid.murching@databricks.com`;
GRANT USE_SCHEMA ON SCHEMA main.agent_traces TO `sid.murching@databricks.com`;
GRANT MODIFY, SELECT ON TABLE main.agent_traces.otel_spans TO `sid.murching@databricks.com`;

-- Step 4: Verify table was created
DESCRIBE TABLE EXTENDED main.agent_traces.otel_spans;

-- Step 5: Check table is empty (should return 0 rows initially)
SELECT COUNT(*) as row_count FROM main.agent_traces.otel_spans;
