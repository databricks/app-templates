Store MLflow traces in Unity Catalog
====================================

Beta

This feature is in [Beta](https://docs.databricks.com/aws/en/release-notes/release-types). Workspace admins can control access to this feature from the Previews page. See [Manage Databricks previews](https://docs.databricks.com/aws/en/admin/workspace-settings/manage-previews).

Databricks supports storing MLflow traces in Unity Catalog tables using an OpenTelemetry-compatible format (OTEL). By default, MLflow stores traces organized by experiments in the MLflow control plane service. However, storing traces in Unity Catalog using OTEL format provides the following benefits:

-   Access control is managed through Unity Catalog schema and table permissions rather than experiment-level ACLs. Users with access to the Unity Catalog tables can view all traces stored in those tables, regardless of which experiment the traces belong to.

-   Trace IDs use URI format instead of the `tr-<UUID>` format, improving compatibility with external systems.

-   Store unlimited traces in Delta tables, enabling long-term retention and analysis of trace data. See [Performance considerations](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/observe-with-traces/query-dbsql#performance-considerations).

-   Query trace data directly using SQL through a Databricks SQL warehouse, enabling advanced analytics and custom reporting.

-   OTEL format ensures compatibility with other OpenTelemetry clients and tools

Prerequisites
-------------

-   A Unity Catalog-enabled workspace.
-   Ensure the "OpenTelemetry on Databricks" preview is enabled. See [Manage Databricks previews](https://docs.databricks.com/aws/en/admin/workspace-settings/manage-previews).s
-   Permissions to create catalogs and schemas in Unity Catalog.
-   A [Databricks SQL warehouse](https://docs.databricks.com/aws/en/compute/sql-warehouse/) with `CAN USE` permissions. Save the warehouse ID for later reference.

-   While this feature is in [Beta](https://docs.databricks.com/aws/en/release-notes/release-types), your workspace must be in one of the following regions:
    -   `us-east-1`
    -   `us-west-2`

-   MLflow Python library version 3.9.0 or later installed in your environment:

    Bash

    ```
    pip install mlflow[databricks]>=3.9.0 --upgrade --force-reinstall
    ```

Setup: Create UC tables and link an experiment
----------------------------------------------

Create the Unity Catalog tables to store the traces. Then, link the Unity Catalog schema containing the tables to an MLflow experiment to write its traces to the tables by default:

Python

```
# Example values for the placeholders below:# MLFLOW_TRACING_SQL_WAREHOUSE_ID: "abc123def456" (found in SQL warehouse URL)# experiment_name: "/Users/user@company.com/traces"# catalog_name: "main" or "my_catalog"# schema_name: "mlflow_traces" or "production_traces"import osimport mlflowfrom mlflow.exceptions import MlflowExceptionfrom mlflow.entities import UCSchemaLocationfrom mlflow.tracing.enablement import set_experiment_trace_locationmlflow.set_tracking_uri("databricks")# Specify the ID of a SQL warehouse you have access to.os.environ["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] = "<SQL_WAREHOUSE_ID>"# Specify the name of the MLflow Experiment to use for viewing traces in the UI.experiment_name = "<MLFLOW_EXPERIMENT_NAME>"# Specify the name of the Catalog to use for storing traces.catalog_name = "<UC_CATALOG_NAME>"# Specify the name of the Schema to use for storing traces.schema_name = "<UC_SCHEMA_NAME>"if experiment := mlflow.get_experiment_by_name(experiment_name):    experiment_id = experiment.experiment_idelse:    experiment_id = mlflow.create_experiment(name=experiment_name)print(f"Experiment ID: {experiment_id}")# To link an experiment to a trace locationresult = set_experiment_trace_location(    location=UCSchemaLocation(catalog_name=catalog_name, schema_name=schema_name),    experiment_id=experiment_id,)print(result.full_otel_spans_table_name)
```

### Verify tables

After running the setup code, three new Unity Catalog tables will be visible in the schema in the Catalog Explorer UI:

-   `mlflow_experiment_trace_otel_logs`
-   `mlflow_experiment_trace_otel_metrics`
-   `mlflow_experiment_trace_otel_spans`

Grant permissions
-----------------

The following permissions are required for a Databricks user or service principal to write or read MLflow Traces from the Unity Catalog tables:

1.  USE_CATALOG permissions on the catalog.
2.  USE_SCHEMA permissions on the schema.
3.  MODIFY and SELECT permissions on each of the `mlflow_experiment_trace_<type>` tables.

note

`ALL_PRIVILEGES` is not sufficient for accessing Unity Catalog trace tables. You must explicitly grant MODIFY and SELECT permissions.

Log traces to the Unity Catalog tables
--------------------------------------

After creating the tables, you can write traces to them from various sources by specifying the trace destination. How you do this depends on the source of the traces.

-   MLflow SDK
-   Databricks App
-   Model Serving endpoint
-   3rd party OTEL client

One benefit of storing traces in the OTEL format is that you can write to the Unity Catalog tables using third party clients that support OTEL. Traces written this way will appear in an MLflow experiment linked to the table as long as they have a root span. The following example shows [OpenTelemetry OTLP exporters](https://opentelemetry-python.readthedocs.io/en/latest/exporter/otlp/otlp.html).

Python

```
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter# Span exporter configurationotlp_trace_exporter = OTLPSpanExporter(    # Databricks hosted OTLP traces collector endpoint    endpoint="https://myworkspace.databricks.com/api/2.0/otel/v1/traces",    headers={        "content-type": "application/x-protobuf",        "X-Databricks-UC-Table-Name": "cat.sch.mlflow_experiment_trace_otel_spans",        "Authorization: Bearer MY_API_TOKEN"    },)
```
