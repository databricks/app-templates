# Create a Vector Search Index

Vector Search indexes let agents search unstructured data (documents, knowledge bases) using semantic similarity. The managed MCP server handles embedding and retrieval automatically.

## Prerequisites

- A Delta table in Unity Catalog with a text column containing the content to search
- A Vector Search endpoint (or create one below)
- The index must use **Databricks-managed embeddings** for the managed MCP server

## Step 1: Create a Vector Search endpoint (if needed)

```bash
databricks vector-search endpoints create \
  --name my-vs-endpoint \
  --endpoint-type STANDARD \
  --profile <profile>
```

Verify it exists:

```bash
databricks vector-search endpoints list --profile <profile>
```

## Step 2: Create the index with managed embeddings

```bash
databricks vector-search indexes create-delta-sync-index \
  --name <catalog>.<schema>.<index-name> \
  --primary-key-column id \
  --endpoint-name my-vs-endpoint \
  --source-table-name <catalog>.<schema>.<source-table> \
  --embedding-source-column content \
  --embedding-model-endpoint-name databricks-bge-large-en \
  --pipeline-type TRIGGERED \
  --profile <profile>
```

Key parameters:
- `--primary-key-column`: Unique row identifier in your source table
- `--embedding-source-column`: The text column to embed and search
- `--embedding-model-endpoint-name`: Use `databricks-bge-large-en` or another embedding endpoint
- `--pipeline-type`: `TRIGGERED` (manual sync) or `CONTINUOUS` (auto-sync on table changes)

## Step 3: Sync the index

For `TRIGGERED` pipelines, start the initial sync:

```bash
databricks vector-search indexes sync \
  --index-name <catalog>.<schema>.<index-name> \
  --profile <profile>
```

## Verify

```bash
databricks vector-search indexes get \
  --index-name <catalog>.<schema>.<index-name> \
  --profile <profile>
```

Check that `status.ready` is `true` before connecting your agent.

## Next step

Wire the Vector Search index into your agent. See the **add-tools** skill and use `examples/vector-search.yaml` for the `databricks.yml` resource grant.

MCP URL: `{host}/api/2.0/mcp/vector-search/{catalog}/{schema}/{index_name}`
