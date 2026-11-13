import pytest

MODEL_SERVICES = ("sonnet_llm", "opus_llm")
EXPECTED_COLUMNS = {
    "ops.action_audit": {
        "audit_id",
        "occurred_at",
        "action",
        "actor",
        "target_ids",
        "amount",
        "outcome",
        "reason",
        "idempotency_key",
    },
    "ops.assistant_activity": {
        "activity_id",
        "owner_email",
        "session_id",
        "run_id",
        "at",
        "tool",
        "identity",
        "target",
        "outcome",
        "status",
        "reference",
        "proposal_id",
    },
}


@pytest.mark.parametrize("table,expected_cols", EXPECTED_COLUMNS.items())
def test_table_columns(table_columns, table: str, expected_cols: set[str]):
    """Audit and Activity tables have expected columns, no extras."""
    actual_cols = table_columns(table)
    assert expected_cols == actual_cols, (
        f"Table {table}: expected {expected_cols}, got {actual_cols}"
    )


EXPECTED_CLUSTERING = {
    "ops.action_audit": ["actor", "idempotency_key"],
    "ops.assistant_activity": ["owner_email", "at"],
}


@pytest.mark.parametrize("table,expected_cols", EXPECTED_CLUSTERING.items())
def test_table_clustering(table_clustering, table: str, expected_cols: list[str]):
    """Tables are clustered on columns read filters use."""
    assert table_clustering(table) == expected_cols


def test_no_app_user_grant_names_a_user(workspace, sql, config, schemas):
    """App user access only through app users group, not direct user grants."""
    objects = sql(
        """
        SELECT 'schema', schema_name, grantee, privilege_type
        FROM information_schema.schema_privileges
        WHERE startswith(schema_name, :prefix) AND inherited_from = 'NONE'
        UNION ALL
        SELECT 'table', concat(table_schema, '.', table_name), grantee, privilege_type
        FROM information_schema.table_privileges
        WHERE startswith(table_schema, :prefix) AND inherited_from = 'NONE'
        UNION ALL
        SELECT 'routine', concat(routine_schema, '.', routine_name), grantee,
          privilege_type
        FROM information_schema.routine_privileges
        WHERE startswith(routine_schema, :prefix) AND inherited_from = 'NONE'
        """,
        {"prefix": f"{config['project']}_"},
    )
    model_services = [
        f"{config['catalog']}.{schemas.ops}.{service}" for service in MODEL_SERVICES
    ]
    app = workspace.apps.get_permissions(config["agent_app_name"])

    user_grants = [row for row in objects if "@" in row[2]]
    user_grants += [
        ["model_service", service, grant.principal, grant.privileges]
        for service in model_services
        for grant in workspace.grants.get(
            "model_service", service
        ).privilege_assignments
        or []
        if "@" in grant.principal
    ]
    user_grants += [
        ["app", config["agent_app_name"], entry.user_name, "CAN_USE"]
        for entry in app.access_control_list or []
        if entry.user_name
        for permission in entry.all_permissions or []
        if permission.permission_level.value == "CAN_USE" and not permission.inherited
    ]

    assert user_grants == []


def test_only_the_evaluation_group_writes_the_benchmark_schema_and_operators_read_it(
    workspace, config, schemas
):
    """Eval group writes the eval schema, ops group reads it, no user or app access."""
    grants = workspace.grants.get(
        securable_type="schema", full_name=f"{config['catalog']}.{schemas.eval}"
    )

    holders = {
        assignment.principal: {privilege.value for privilege in assignment.privileges}
        for assignment in grants.privilege_assignments or []
    }
    assert holders == {
        config["eval_group"]: {
            "USE_SCHEMA",
            "CREATE_TABLE",
            "CREATE_FUNCTION",
            "EXECUTE",
            "MANAGE",
        },
        config["ops_group"]: {"USE_SCHEMA", "SELECT"},
    }
