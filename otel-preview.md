# Onboarding Guide

To accept this invitation on behalf of your organization and access these private previews, please see the following steps:

1. Accept the relevant PrPr terms and conditions  
2. Enable (if not already) the OTel collector preview for your relevant workspaces

| ![][image1] |
| :---- |

3. Create the Unity Catalog Tables that the OTel collector will write to using the following [DBSQL queries](?tab=t.0#bookmark=id.5u0hokf2ilog)  
4. Generate an auth token ([documentation](https://docs.databricks.com/aws/en/dev-tools/auth/#account-level-apis-and-workspace-level-apis)) for writing to the target Unity Catalog Tables which will be used by your OTel Client.  
5. Grant these **exact permissions** for raw tables to the auth token. (**Note**: ALL\_PRIVILEGES are not enough due to a known issue and will be addressed soon)  
   1. **USE\_CATALOG** on the catalog  
   2. **USE\_SCHEMA** on the schema  
   3. **MODIFY** and **SELECT** on the target delta tables  
6. Configure your OTel client SDK to export data to the Databricks OTel collector using the following configurations  
   1. **Endpoints:**   
      1. {workspace\_url}/api/2.0/otel/v1/traces  
      2. {workspace\_url}/api/2.0/otel/v1/logs  
      3. {workspace\_url}/api/2.0/otel/v1/metrics  
   2. **Custom exporter headers**  
      1. Target UC table: `X-Databricks-UC-Table-Name: <OTEL_TABLE>`  
      2. Auth headers: `Authorization: Bearer <AUTH_TOKEN>`

**→ See an example app setup in Python [here](#simple-python-example).**  
**→ See Unity Catalog Table Schema [here](?tab=t.0#bookmark=id.5u0hokf2ilog).**

**Open Telemetry Configuration**

```shell
# Protocol
exporter_otlp_protocol: http/protobuf

# Endpoints
exporter_otlp_logs_endpoint: "https://myworkspace.databricks.com/api/2.0/otel/v1/logs"
exporter_otlp_spans_endpoint: "https://myworkspace.databricks.com/api/2.0/otel/v1/traces"
exporter_otlp_metrics_endpoint: "https://myworkspace.databricks.com/api/2.0/otel/v1/metrics"

# Headers (note that there is a different table for each type)
content-type=application/x-protobuf
X-Databricks-UC-Table-Name=<catalog>.<schema>.<prefix>_otel_<type>
Authorization=Bearer <token>
```

**Example inline code**

```py
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

# Span exporter configuration
otlp_trace_exporter = OTLPSpanExporter(
    # Databricks hosted OTLP traces collector endpoint
    endpoint="https://myworkspace.databricks.com/api/2.0/otel/v1/traces",
    headers={
        "content-type": "application/x-protobuf",
        "X-Databricks-UC-Table-Name": "cat.sch.my_prefix_otel_spans",
        "Authorization: Bearer MY_API_TOKEN"
    },
)

# Log exporter
otlp_log_exporter = OTLPLogExporter(
    # Databricks hotsed OTLP logs collector endpoint
    endpoint="https://myworkspace.databricks.com/api/2.0/otel/v1/logs",
    headers={
        "content-type": "application/x-protobuf",
        "X-Databricks-UC-Table-Name": "cat.sch.my_prefix_otel_logs",
        "Authorization": "Bearer MY_API_TOKEN"
    },
)

# Metric exporter
metrics_exporter = OTLPMetricExporter(
    # Databricks hotsed OTLP metrics collector endpoint
    endpoint="https://myworkspace.databricks.com/api/2.0/otel/v1/metrics",
    headers={
        "content-type": "application/x-protobuf",
        "X-Databricks-UC-Table-Name": "cat.sch.my_prefix_otel_metrics",
        "Authorization": "Bearer MY_API_TOKEN"
    },
)
```

# Appendix

## Simple Python Example {#simple-python-example}

Here is an example of how to configure a Python application, as shown in the OTEL Python documentation.  
→ [https://opentelemetry.io/docs/languages/python/getting-started/](https://opentelemetry.io/docs/languages/python/getting-started/)

1. Install Flask and create a simple web application  
   1. [https://opentelemetry.io/docs/languages/python/getting-started/\#installation](https://opentelemetry.io/docs/languages/python/getting-started/#installation)  
2. Install the `opentelemetry-instrument` agent for a simple “Zero-Code” telemetry forwarding.  
   1. [https://opentelemetry.io/docs/languages/python/getting-started/\#instrumentation](https://opentelemetry.io/docs/languages/python/getting-started/#instrumentation)  
3. Run the instrumented app, but configured to push to Zerobus Ingest OTEL endpoints.  
   1. [https://opentelemetry.io/docs/languages/python/getting-started/\#run-the-instrumented-app](https://opentelemetry.io/docs/languages/python/getting-started/#run-the-instrumented-app)

```shell
export OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true
opentelemetry-instrument \
--service_name <service name> \
--metrics_exporter none \
--traces_exporter otlp \
--logs_exporter otlp \
--exporter_otlp_protocol http/protobuf \
--exporter_otlp_logs_endpoint https://<workspace>.cloud.databricks.com/api/2.0/otel/v1/logs \
--exporter_otlp_logs_headers "content-type=application/x-protobuf,X-Databricks-UC-Table-Name=<catalog>.<schema>.<prefix>_otel_logs,Authorization=Bearer <token>" \
--exporter_otlp_traces_endpoint https://<workspace>.cloud.databricks.com/api/2.0/otel/v1/traces \
--exporter_otlp_traces_headers "content-type=application/x-protobuf,X-Databricks-UC-Table-Name=<catalog>.<schema>.<prefix>_otel_spans,Authorization=Bearer <token>" \
flask run -p 8080
```

## Unity Catalog Table Schema

The following are the UC table schemas that are compatible with the official [OTLP specifications](https://github.com/open-telemetry/opentelemetry-proto/tree/main/opentelemetry/proto).

#### **Spans**

```sql
CREATE TABLE <catalog>.<schema>.<table_prefix>_otel_spans (
  trace_id STRING,
  span_id STRING,
  trace_state STRING,
  parent_span_id STRING,
  flags INT,
  name STRING,
  kind STRING,  
  start_time_unix_nano LONG,
  end_time_unix_nano LONG,
  attributes MAP<STRING, STRING>,
  dropped_attributes_count INT,
  events ARRAY<STRUCT<
    time_unix_nano: LONG,
    name: STRING,
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >>,
  dropped_events_count INT,
  links ARRAY<STRUCT<
    trace_id: STRING,
    span_id: STRING,
    trace_state: STRING,
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT,
    flags: INT
  >>,
  dropped_links_count INT,
  status STRUCT<
    message: STRING,
    code: STRING
  >,
  resource STRUCT<
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >,
  resource_schema_url STRING,
  instrumentation_scope STRUCT<
    name: STRING,
    version: STRING,
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >,
  span_schema_url STRING
) USING DELTA
TBLPROPERTIES (
  'otel.schemaVersion' = 'v1'
)
```

#### **Logs**

```sql
CREATE TABLE <catalog>.<schema>.<table_prefix>_otel_logs (
  event_name STRING,
  trace_id STRING,
  span_id STRING,
  time_unix_nano LONG,
  observed_time_unix_nano LONG,
  severity_number STRING,
  severity_text STRING,
  body STRING,
  attributes MAP<STRING, STRING>,
  dropped_attributes_count INT,
  flags INT,
  resource STRUCT<
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >,
  resource_schema_url STRING,
  instrumentation_scope STRUCT<
    name: STRING,
    version: STRING,
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >,
  log_schema_url STRING
) USING DELTA
TBLPROPERTIES (
  'otel.schemaVersion' = 'v1'
)
```

#### **Metrics**

```sql
CREATE TABLE <catalog>.<schema>.<table_prefix>_otel_metrics (
  name STRING,
  description STRING,
  unit STRING,
  metric_type STRING,
  gauge STRUCT<
    start_time_unix_nano: LONG,
    time_unix_nano: LONG,
    value: DOUBLE,
    exemplars: ARRAY<STRUCT<
      time_unix_nano: LONG,
      value: DOUBLE,
      span_id: STRING,
      trace_id: STRING,
      filtered_attributes: MAP<STRING, STRING>
    >>,
    attributes: MAP<STRING, STRING>,
    flags: INT
  >,
  sum STRUCT<
    start_time_unix_nano: LONG,
    time_unix_nano: LONG,
    value: DOUBLE,
    exemplars: ARRAY<STRUCT<
      time_unix_nano: LONG,
      value: DOUBLE,
      span_id: STRING,
      trace_id: STRING,
      filtered_attributes: MAP<STRING, STRING>
    >>,
    attributes: MAP<STRING, STRING>,
    flags: INT,
    aggregation_temporality: STRING,
    is_monotonic: BOOLEAN
  >,
  histogram STRUCT<
    start_time_unix_nano: LONG,
    time_unix_nano: LONG,
    count: LONG,
    sum: DOUBLE,
    bucket_counts: ARRAY<LONG>,
    explicit_bounds: ARRAY<DOUBLE>,
    exemplars: ARRAY<STRUCT<
      time_unix_nano: LONG,
      value: DOUBLE,
      span_id: STRING,
      trace_id: STRING,
      filtered_attributes: MAP<STRING, STRING>
    >>,
    attributes: MAP<STRING, STRING>,
    flags: INT,
    min: DOUBLE,
    max: DOUBLE,
    aggregation_temporality: STRING
  >,
  exponential_histogram STRUCT<
    attributes: MAP<STRING, STRING>,
    start_time_unix_nano: LONG,
    time_unix_nano: LONG,
    count: LONG,
    sum: DOUBLE,
    scale: INT,
    zero_count: LONG,
    positive_bucket: STRUCT<
      offset: INT,
      bucket_counts: ARRAY<LONG>
    >,
    negative_bucket: STRUCT<
      offset: INT,
      bucket_counts: ARRAY<LONG>
    >,
    flags: INT,
    exemplars: ARRAY<STRUCT<
      time_unix_nano: LONG,
      value: DOUBLE,
      span_id: STRING,
      trace_id: STRING,
      filtered_attributes: MAP<STRING, STRING>
    >>,
    min: DOUBLE,
    max: DOUBLE,
    zero_threshold: DOUBLE,
    aggregation_temporality: STRING
  >,
  summary STRUCT<
    start_time_unix_nano: LONG,
    time_unix_nano: LONG,
    count: LONG,
    sum: DOUBLE,
    quantile_values: ARRAY<STRUCT<
      quantile: DOUBLE,
      value: DOUBLE
    >>,
    attributes: MAP<STRING, STRING>,
    flags: INT
  >,
  metadata MAP<STRING, STRING>,
  resource STRUCT<
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >,
  resource_schema_url STRING,
  instrumentation_scope STRUCT<
    name: STRING,
    version: STRING,
    attributes: MAP<STRING, STRING>,
    dropped_attributes_count: INT
  >,
  metric_schema_url STRING
) USING DELTA
TBLPROPERTIES (
  'otel.schemaVersion' = 'v1'
)
```


