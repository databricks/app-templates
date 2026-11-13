import pytest

pytestmark = pytest.mark.app_scope

METADATA_ONLY = {"READ_METADATA"}


def effective_privileges(cli, principal: str, securable_type: str, name: str) -> set:
    effective = cli(
        "grants", "get-effective", securable_type, name, "--principal", principal
    )
    return {
        grant["privilege"]
        for assignment in effective.get("privilege_assignments", [])
        for grant in assignment["privileges"]
    }


def app_principal(cli, config) -> str:
    return cli("apps", "get", config["agent_app_name"])["service_principal_client_id"]


def test_agent_app_identity_holds_no_privileges_on_the_data_schema(
    cli, config, schemas
):
    schema = f"{config['catalog']}.{schemas.data}"

    privileges = effective_privileges(cli, app_principal(cli, config), "schema", schema)

    assert privileges <= METADATA_ONLY


def test_agent_app_identity_holds_no_privileges_on_any_data_table(cli, config, schemas):
    principal = app_principal(cli, config)
    tables = cli("tables", "list", config["catalog"], schemas.data)

    held = {}
    for table in tables:
        name = table["full_name"]
        extra = effective_privileges(cli, principal, "table", name) - METADATA_ONLY
        if extra:
            held[name] = extra

    assert tables
    assert held == {}
