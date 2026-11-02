import json

import pytest


@pytest.mark.parametrize("table", ["action_audit", "assistant_activity"])
def test_audit_tables_are_append_only(workspace, config, table, schemas):
    """Verify audit and Activity tables are append-only."""
    response = workspace.statement_execution.execute_statement(
        statement=f"DESCRIBE DETAIL {schemas.ops}.{table}",
        warehouse_id=config["warehouse_id"],
        catalog=config["catalog"],
        wait_timeout="50s",
    )
    columns = [column.name for column in response.manifest.schema.columns]
    detail = dict(zip(columns, response.result.data_array[0], strict=True))
    properties = json.loads(detail["properties"])
    assert properties.get("delta.appendOnly") == "true", (
        f"{table} must have delta.appendOnly = 'true' to prevent accidental deletion"
    )
