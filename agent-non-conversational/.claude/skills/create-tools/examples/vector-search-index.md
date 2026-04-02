# Create a Vector Search Index

Vector Search indexes let agents search unstructured data (documents, knowledge bases) using semantic similarity. The managed MCP server handles embedding and retrieval automatically.

## Prerequisites

- Unity Catalog enabled in your workspace
- Serverless compute enabled
- A Delta table in Unity Catalog with a text column containing the content to search
- Change Data Feed enabled on the source table (for standard endpoints)
- The index must use **Databricks-managed embeddings** for the managed MCP server

## Step 1: Create a Vector Search endpoint (if needed)

```bash
databricks vector-search-endpoints create-endpoint my-vs-endpoint STANDARD --profile <profile>
```

Verify it exists:

```bash
databricks vector-search-endpoints list-endpoints --profile <profile>
```

## Step 2: Create the index with managed embeddings

```bash
databricks vector-search-indexes create-index \
  <catalog>.<schema>.<index-name> \
  my-vs-endpoint \
  id \
  DELTA_SYNC \
  --json '{
    "delta_sync_index_spec": {
      "source_table": "<catalog>.<schema>.<source-table>",
      "pipeline_type": "TRIGGERED",
      "embedding_source_columns": [
        {
          "name": "content",
          "embedding_model_endpoint_name": "databricks-gte-large-en"
        }
      ]
    }
  }' \
  --profile <profile>
```

Key parameters:
- Positional args: `NAME`, `ENDPOINT_NAME`, `PRIMARY_KEY`, `INDEX_TYPE`
- `source_table`: The Delta table to index
- `embedding_source_columns.name`: The text column to embed and search
- `embedding_model_endpoint_name`: Use `databricks-gte-large-en` (recommended) or another embedding endpoint
- `pipeline_type`: `TRIGGERED` (manual sync) or `CONTINUOUS` (auto-sync on table changes)

## Step 3: Sync the index

For `TRIGGERED` pipelines, start the initial sync:

```bash
databricks vector-search-indexes sync-index <catalog>.<schema>.<index-name> --profile <profile>
```

## Verify

```bash
databricks vector-search-indexes get-index <catalog>.<schema>.<index-name> --profile <profile>
```

Check that `status.ready` is `true` before connecting your agent.

## Next step

Wire the Vector Search index into your agent. See the **add-tools** skill and use `examples/vector-search.yaml` for the `databricks.yml` resource grant.

MCP URL: `{host}/api/2.0/mcp/vector-search/{catalog}/{schema}/{index_name}`
