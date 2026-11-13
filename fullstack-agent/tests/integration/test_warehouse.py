import json
import subprocess

import pytest
from databricks.sdk import WorkspaceClient

MANAGE_LEVELS = {"CAN_MANAGE", "IS_OWNER"}


@pytest.fixture(scope="module")
def app_warehouse_id() -> str:
    """Bundle's app warehouse ID from deployment state."""
    result = subprocess.run(
        ["databricks", "bundle", "summary", "-o", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    warehouses = json.loads(result.stdout)["resources"].get("sql_warehouses", {})
    warehouse_id = warehouses.get("app_warehouse", {}).get("id")
    assert warehouse_id, (
        "The bundle has no deployed app_warehouse. Run databricks bundle deploy, "
        "then the tests again."
    )
    return warehouse_id


def direct_permissions(
    workspace: WorkspaceClient, warehouse_id: str
) -> dict[str, set[str]]:
    """Map principals to their direct permission levels."""
    held: dict[str, set[str]] = {}
    acl = workspace.warehouses.get_permissions(warehouse_id).access_control_list
    for entry in acl or []:
        principal = entry.group_name or entry.service_principal_name or entry.user_name
        held[principal] = {
            permission.permission_level.value
            for permission in entry.all_permissions or []
            if not permission.inherited
        }
    return held


def test_the_app_warehouse_is_serverless_small_with_two_clusters(
    workspace: WorkspaceClient, app_warehouse_id: str
):
    warehouse = workspace.warehouses.get(app_warehouse_id)

    assert warehouse.enable_serverless_compute is True
    assert warehouse.cluster_size == "Small"
    assert (warehouse.min_num_clusters, warehouse.max_num_clusters) == (1, 2)


def test_only_app_users_operators_and_the_app_can_use_the_app_warehouse(
    workspace: WorkspaceClient, config: dict[str, str], app_warehouse_id: str
):
    """App users, operators and app identity only use it; only the deployer manages."""
    app_id = workspace.apps.get(config["agent_app_name"]).service_principal_client_id
    managers = {workspace.current_user.me().user_name}
    held = direct_permissions(workspace, app_warehouse_id)

    users = {principal for principal, levels in held.items() if "CAN_USE" in levels}
    assert users - {app_id} == {
        config["app_users_group"],
        config["agent_apps_group"],
        config["ops_group"],
    }
    assert {p for p, levels in held.items() if levels & MANAGE_LEVELS} <= managers
    assert "users" not in held


def test_the_agent_app_reads_its_warehouse_from_an_app_resource(
    workspace: WorkspaceClient, config: dict[str, str], app_warehouse_id: str
):
    app = workspace.apps.get(config["agent_app_name"])
    resources = {resource.name: resource for resource in app.resources or []}

    assert "app_warehouse" in resources, f"app resources: {sorted(resources)}"
    warehouse = resources["app_warehouse"].sql_warehouse
    assert warehouse.id == app_warehouse_id
    assert warehouse.permission.value == "CAN_USE"


def test_the_app_warehouse_carries_the_cost_tags(
    workspace: WorkspaceClient, app_warehouse_id: str
):
    """Warehouse carries bundle's cost tags for budgeting."""
    result = subprocess.run(
        ["databricks", "bundle", "validate", "-o", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    declared = json.loads(result.stdout)["resources"]["sql_warehouses"][
        "app_warehouse"
    ]["tags"]["custom_tags"]
    warehouse = workspace.warehouses.get(app_warehouse_id)
    tags = {tag.key: tag.value for tag in (warehouse.tags.custom_tags or [])}

    assert declared, "the bundle declares no cost tags"
    assert tags == {tag["key"]: tag["value"] for tag in declared}


def test_the_model_service_carries_the_app_warehouse_tags(workspace: WorkspaceClient):
    """Model service carries app warehouse tags for usage tracking."""
    result = subprocess.run(
        ["databricks", "bundle", "validate", "-o", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    resources = json.loads(result.stdout)["resources"]
    service = resources["model_services"]["sonnet_llm"]
    ops = resources["schemas"]["ops"]
    name = f"{ops['catalog_name']}.{ops['name']}.{service['model_service_id']}"
    declared = resources["sql_warehouses"]["app_warehouse"]["tags"]["custom_tags"]
    expected = {tag["key"]: tag["value"] for tag in declared}

    assigned = workspace.entity_tag_assignments.list("model-services", name)
    tags = {tag.tag_key: tag.tag_value for tag in assigned}
    assert tags.items() >= expected.items(), tags
