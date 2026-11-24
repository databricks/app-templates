import json
import subprocess
from types import SimpleNamespace

import pytest
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.ml import Experiment

READ_PRIVILEGES = {"SELECT", "ALL_PRIVILEGES"}
TRACE_TABLE_TAG = "mlflow.experiment.databricksTrace{}StorageTable"
WRITTEN_KINDS = ("Span", "Log", "Metric", "Annotation")
SCORED_KINDS = ("Span", "Annotation")
EVAL_PRIVILEGES = {"spans": {"SELECT"}, "annotations": {"SELECT", "MODIFY"}}
APP_TELEMETRY_KINDS = ("logs", "metrics", "spans")


@pytest.fixture(scope="module")
def bundle() -> dict:
    result = subprocess.run(
        ["databricks", "bundle", "validate", "-o", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


@pytest.fixture(scope="module")
def experiment(workspace: WorkspaceClient, bundle: dict) -> Experiment:
    """Bundle's trace experiment by name."""
    name = bundle["resources"]["experiments"]["agent_traces"]["name"]
    return workspace.experiments.get_by_name(name).experiment


@pytest.fixture(scope="module")
def app_telemetry_prefix(config: dict[str, str], schemas: SimpleNamespace) -> str:
    """Full path prefix for app telemetry tables."""
    return f"{config['catalog']}.{schemas.ops}.{config['app_telemetry_table_prefix']}"


@pytest.fixture(scope="module")
def app_id(workspace: WorkspaceClient, config: dict[str, str]) -> str:
    return workspace.apps.get(config["agent_app_name"]).service_principal_client_id


def trace_tables(experiment: Experiment, kinds: tuple[str, ...]) -> list[str]:
    """Full names of experiment trace tables for given kinds."""
    tags = {tag.key: tag.value for tag in experiment.tags or []}
    names = [tags.get(TRACE_TABLE_TAG.format(kind)) for kind in kinds]
    assert all(names), f"experiment {experiment.name} lacks trace table tags: {tags}"
    return names


def readers(workspace: WorkspaceClient, table: str, catalog_owner: str) -> set[str]:
    """Principals that can read table, excluding catalog owner."""
    effective = workspace.grants.get_effective("table", table)
    return {
        assignment.principal
        for assignment in effective.privilege_assignments or []
        for grant in assignment.privileges or []
        if grant.privilege.value in READ_PRIVILEGES
        and assignment.principal != catalog_owner
    }


def test_only_operators_the_app_the_data_owner_and_the_scorers_read_the_trace_tables(
    workspace: WorkspaceClient,
    config: dict[str, str],
    experiment: Experiment,
    app_id: str,
):
    """Ops, app, data owner, and scorers read trace tables with no row filter."""
    catalog_owner = workspace.catalogs.get(config["catalog"]).owner
    data_owner = config["data_owner_application_id"]
    scored = set(trace_tables(experiment, SCORED_KINDS))

    for table in trace_tables(experiment, WRITTEN_KINDS):
        scorers = {config["eval_group"]} if table in scored else set()
        assert (
            readers(workspace, table, catalog_owner)
            == {
                config["ops_group"],
                app_id,
                data_owner,
            }
            | scorers
        ), table
        modify = workspace.grants.get_effective("table", table, principal=data_owner)
        held = {
            grant.privilege.value
            for assignment in modify.privilege_assignments or []
            for grant in assignment.privileges or []
        }
        assert "MODIFY" in held, f"{data_owner} can't delete old rows from {table}"
        eval_grants = workspace.grants.get(
            "table", table, principal=config["eval_group"]
        )
        eval_held = {
            privilege.value
            for assignment in eval_grants.privilege_assignments or []
            for privilege in assignment.privileges or []
        }
        assert eval_held == EVAL_PRIVILEGES.get(table.rsplit("_", 1)[-1], set()), table
    (unified,) = trace_tables(experiment, ("",))
    assert readers(workspace, unified, catalog_owner) == {
        config["ops_group"],
        config["eval_group"],
    }


@pytest.mark.parametrize("group", ["ops_group", "eval_group"])
def test_operators_and_scorers_can_reach_the_trace_tables_they_hold_grants_on(
    workspace: WorkspaceClient,
    config: dict[str, str],
    schemas: SimpleNamespace,
    group: str,
):
    """Table grants work only with USE CATALOG and USE SCHEMA on the parents."""
    catalog = config["catalog"]
    for securable_type, full_name, privilege in (
        ("catalog", catalog, "USE_CATALOG"),
        ("schema", f"{catalog}.{schemas.ops}", "USE_SCHEMA"),
    ):
        effective = workspace.grants.get_effective(
            securable_type, full_name, principal=config[group]
        )
        held = {
            grant.privilege.value
            for assignment in effective.privilege_assignments or []
            for grant in assignment.privileges or []
        }
        assert privilege in held, f"{config[group]} lacks {privilege} on {full_name}"


def test_the_trace_experiment_is_shared_only_with_operators_the_app_and_the_scorers(
    workspace: WorkspaceClient,
    config: dict[str, str],
    experiment: Experiment,
    app_id: str,
):
    """Ops, app, and scorers get experiment permissions, app via group."""
    acl = workspace.experiments.get_permissions(experiment.experiment_id)
    groups = {
        entry.group_name: {
            permission.permission_level.value
            for permission in entry.all_permissions or []
        }
        for entry in acl.access_control_list or []
        if entry.group_name
    }
    assert not {"users", "account users"} & set(groups), groups
    assert "CAN_EDIT" in groups.get(config["agent_apps_group"], set()), groups
    assert "CAN_READ" in groups.get(config["ops_group"], set()), groups
    assert "CAN_EDIT" in groups.get(config["eval_group"], set()), groups

    iam = workspace.workspace_iam_v2
    (group,) = iam.list_groups_proxy(
        filter=f'group_name eq "{config["agent_apps_group"]}"'
    )
    (service_principal,) = workspace.service_principals.list(
        filter=f'applicationId eq "{app_id}"'
    )
    members = {
        member.principal_id
        for member in iam.list_direct_group_members_proxy(group.group_id)
    }
    assert int(service_principal.id) in members


def test_nobody_but_its_owner_reads_the_model_service_inference_table(
    workspace: WorkspaceClient,
    config: dict[str, str],
    bundle: dict,
    schemas: SimpleNamespace,
):
    """Only model service owner reads inference table."""
    service = bundle["resources"]["model_services"]["sonnet_llm"]
    prefix = service["config"]["inference_table"]["table_name_prefix"]
    table = f"{config['catalog']}.{schemas.ops}.{prefix}_payload"
    catalog_owner = workspace.catalogs.get(config["catalog"]).owner

    assert readers(workspace, table, catalog_owner) == set(), table


def test_the_agent_app_exports_telemetry_to_the_bundles_tables(
    workspace: WorkspaceClient, config: dict[str, str], app_telemetry_prefix: str
):
    """App telemetry export destinations match bundle tables."""
    (destination,) = workspace.apps.get(
        config["agent_app_name"]
    ).telemetry_export_destinations
    assert destination.unity_catalog.as_dict() == {
        "logs_table": f"{app_telemetry_prefix}_otel_logs",
        "metrics_table": f"{app_telemetry_prefix}_otel_metrics",
        "traces_table": f"{app_telemetry_prefix}_otel_spans",
    }


def test_only_operators_the_app_and_the_data_owner_read_the_app_telemetry_tables(
    workspace: WorkspaceClient,
    config: dict[str, str],
    app_id: str,
    app_telemetry_prefix: str,
):
    """Ops, app, and data owner read app telemetry tables."""
    catalog_owner = workspace.catalogs.get(config["catalog"]).owner
    operators_and_owner = {config["ops_group"], config["data_owner_application_id"]}

    for kind in APP_TELEMETRY_KINDS:
        table = f"{app_telemetry_prefix}_otel_{kind}"
        assert readers(workspace, table, catalog_owner) == {
            *operators_and_owner,
            app_id,
        }, table
    annotations = f"{app_telemetry_prefix}_otel_annotations"
    assert readers(workspace, annotations, catalog_owner) == operators_and_owner
