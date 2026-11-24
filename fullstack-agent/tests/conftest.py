import json
import subprocess
from dataclasses import dataclass
from functools import cache
from types import SimpleNamespace

import pytest
from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
from databricks.sdk.service.sql import StatementParameterListItem, StatementState

CATALOG_WIDE_WRITE_PRIVILEGES = {"ALL_PRIVILEGES", "MODIFY", "EXECUTE"}
TEST_USERS = [
    ("test_user_one_id", "test user one"),
    ("test_user_two_id", "test user two"),
]


class StatementFailed(Exception):
    """A SQL statement did not succeed; the message is the warehouse's error text."""


@cache
def bundle_variables() -> dict[str, str]:
    """Return the resolved variables of the bundle's default target."""
    result = subprocess.run(
        ["databricks", "bundle", "validate", "-o", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    variables = json.loads(result.stdout)["variables"]
    return {name: spec["value"] for name, spec in variables.items()}


@pytest.fixture(scope="session")
def config() -> dict[str, str]:
    return bundle_variables()


@pytest.fixture(scope="session")
def schemas(config: dict[str, str]) -> SimpleNamespace:
    """App schemas named `<project>_<kind>`."""
    project = config["project"]
    return SimpleNamespace(
        data=f"{project}_data",
        reference=f"{project}_reference",
        ops=f"{project}_ops",
        eval=f"{project}_eval",
    )


@pytest.fixture(scope="session")
def workspace() -> WorkspaceClient:
    return WorkspaceClient()


def get_service_principal_id(workspace: WorkspaceClient, app_id: str) -> str:
    """Get the SCIM ID for a service principal by its application ID."""
    service_principals = workspace.service_principals.list(
        filter=f'applicationId eq "{app_id}"'
    )
    for sp in service_principals:
        return sp.id
    return ""


def create_user_m2m_token(
    workspace: WorkspaceClient, config: dict[str, str], user_id_var: str
) -> str:
    """Create a test user's M2M OAuth token for workspace SQL operations."""
    app_id = config.get(user_id_var, "")
    if not app_id:
        raise ValueError(
            f"{user_id_var} is not set. Set it in "
            ".databricks/bundle/<target>/variable-overrides.json with the "
            "service principal's ID from scripts/setup_identities.sh."
        )

    scim_id = get_service_principal_id(workspace, app_id)
    if not scim_id:
        raise ValueError(
            f"Service principal {app_id} (from {user_id_var}) not found. "
            "Run scripts/setup_identities.sh to create it."
        )

    secret = workspace.service_principal_secrets_proxy.create(
        service_principal_id=scim_id, lifetime="3600s"
    )
    try:
        cfg = Config(
            host=workspace.config.host,
            client_id=app_id,
            client_secret=secret.secret,
            auth_type="oauth-m2m",
        )
        return cfg.oauth_token().access_token
    finally:
        workspace.service_principal_secrets_proxy.delete(
            service_principal_id=scim_id, secret_id=secret.id
        )


@pytest.fixture(scope="session")
def test_user_one_token(workspace: WorkspaceClient, config: dict[str, str]) -> str:
    """The first test user's M2M OAuth token."""
    return create_user_m2m_token(workspace, config, "test_user_one_id")


@pytest.fixture(scope="session")
def test_user_two_token(workspace: WorkspaceClient, config: dict[str, str]) -> str:
    """The second test user's M2M OAuth token."""
    return create_user_m2m_token(workspace, config, "test_user_two_id")


@pytest.fixture(scope="session")
def test_user_one_client(
    workspace: WorkspaceClient, config: dict[str, str], test_user_one_token: str
) -> WorkspaceClient:
    """A workspace client for the first test user."""
    return WorkspaceClient(
        host=workspace.config.host,
        token=test_user_one_token,
        auth_type="pat",
    )


@pytest.fixture(scope="session", autouse=True)
def user_privileges_only(workspace: WorkspaceClient, config: dict[str, str]):
    """Stop run if test users hold catalog-wide write privileges."""
    catalog = config["catalog"]

    for user_var, user_label in TEST_USERS:
        app_id = config[user_var]
        effective = workspace.grants.get_effective("catalog", catalog, principal=app_id)
        held = {
            grant.privilege.value
            for assignment in effective.privilege_assignments or []
            for grant in assignment.privileges or []
        }
        if extra := sorted(held & CATALOG_WIDE_WRITE_PRIVILEGES):
            change = json.dumps({"changes": [{"principal": app_id, "remove": extra}]})
            pytest.exit(
                f"{user_label} ({app_id}) holds {', '.join(extra)} on catalog "
                f"{catalog}, so the tests would not verify proper access control. "
                "Revoke these privileges, then run the tests again: "
                f"databricks grants update catalog {catalog} --json '{change}'",
                returncode=1,
            )


@pytest.fixture(scope="session", autouse=True)
def app_users_include_test_users(workspace: WorkspaceClient, config: dict[str, str]):
    """Stop run if a test user is not a direct member of the app users group."""
    group_name = config["app_users_group"]
    iam = workspace.workspace_iam_v2
    members = {
        str(member.principal_id)
        for group in iam.list_groups_proxy(filter=f'group_name eq "{group_name}"')
        for member in iam.list_direct_group_members_proxy(group.group_id)
    }
    for user_var, user_label in TEST_USERS:
        app_id = config[user_var]
        if get_service_principal_id(workspace, app_id) not in members:
            pytest.exit(
                f"{user_label} ({app_id}) is not in {group_name}. "
                "Run scripts/setup_identities.sh, then the tests again.",
                returncode=1,
            )


@pytest.fixture(scope="session")
def sql(test_user_one_client: WorkspaceClient, config: dict[str, str]) -> callable:
    """Run one statement as test user one and return rows as lists of strings."""

    def run(statement: str, parameters: dict[str, str] | None = None) -> list[list]:
        response = test_user_one_client.statement_execution.execute_statement(
            statement=statement,
            warehouse_id=config["warehouse_id"],
            catalog=config["catalog"],
            parameters=[
                StatementParameterListItem(name=name, value=value)
                for name, value in (parameters or {}).items()
            ],
            wait_timeout="50s",
        )
        if response.status.state != StatementState.SUCCEEDED:
            message = response.status.error.message if response.status.error else ""
            raise StatementFailed(f"{response.status.state.value}: {message}")
        if response.result is None:
            return []
        return response.result.data_array or []

    return run


@pytest.fixture(scope="session")
def table_columns(sql, config, schemas) -> callable:
    """Return the columns of a `<kind>.<table>` table, such as `ops.action_audit`."""

    def columns(table: str) -> set[str]:
        kind, name = table.split(".")
        rows = sql(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_catalog = :catalog AND table_schema = :table_schema "
            "AND table_name = :table_name "
            "AND column_name NOT LIKE '%$$SCHEMA_VERSION%'",
            {
                "catalog": config["catalog"],
                "table_schema": getattr(schemas, kind),
                "table_name": name,
            },
        )
        return {row[0] for row in rows}

    return columns


@pytest.fixture(scope="session")
def table_clustering(workspace, config, schemas) -> callable:
    """Return the clustering columns of a `<kind>.<table>` table, in order."""

    def clustering(table: str) -> list[str]:
        kind, name = table.split(".")
        response = workspace.statement_execution.execute_statement(
            statement=f"DESCRIBE DETAIL {getattr(schemas, kind)}.{name}",
            warehouse_id=config["warehouse_id"],
            catalog=config["catalog"],
            wait_timeout="50s",
        )
        if response.status.state != StatementState.SUCCEEDED:
            message = response.status.error.message if response.status.error else ""
            raise StatementFailed(f"{response.status.state.value}: {message}")
        columns = [column.name for column in response.manifest.schema.columns]
        detail = dict(zip(columns, response.result.data_array[0], strict=True))
        return json.loads(detail["clusteringColumns"])

    return clustering


@dataclass
class ProcedureResult:
    status: str
    reference: str | None
    acted_as: str
    message: str | None


@pytest.fixture
def call(sql, schemas):
    """Call one write procedure as test user one and return its OUT parameters."""

    def run(procedure: str, arguments: str, parameters: dict) -> ProcedureResult:
        statement = (
            "BEGIN "
            "DECLARE out_status STRING; DECLARE out_reference STRING; "
            "DECLARE out_acted_as STRING; DECLARE out_message STRING; "
            f"CALL {schemas.ops}.{procedure}({arguments}, "
            "out_status, out_reference, out_acted_as, out_message); "
            "SELECT out_status, out_reference, out_acted_as, out_message; "
            "END"
        )
        return ProcedureResult(*sql(statement, parameters)[0])

    return run
