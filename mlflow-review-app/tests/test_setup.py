"""The /setup checks, the Grant button, and how the UI files are served."""

import pytest
from conftest import ALICE, ALL_GOOD, ANN, API, FakeGateway, as_, with_token

ALICE_H = as_(ALICE)
MISSING_MODIFY = {**ALL_GOOD, ANN: ["SELECT"]}


def checks(boot, **opts):
    client, _, _ = boot(FakeGateway(**opts))
    r = client.get(f"{API}/setup", headers=ALICE_H)
    assert r.status_code == 200, r.text
    return {c["name"]: c for c in r.json()["checks"]}


def ann_check(boot, **opts):
    return checks(boot, privileges=dict(MISSING_MODIFY), **opts)[f"MODIFY, SELECT on {ANN}"]


def test_all_checks_pass(boot):
    c = checks(boot, privileges=dict(ALL_GOOD))
    assert all(x["ok"] is True for x in c.values())
    assert c[f"MODIFY, SELECT on {ANN}"]["label"] == "Answers: read and write"
    assert len(c) == 9


def test_a_missing_modify_shows_the_grant(boot):
    c = checks(boot, privileges=dict(MISSING_MODIFY))
    assert c[f"MODIFY, SELECT on {ANN}"]["ok"] is False
    assert c[f"MODIFY, SELECT on {ANN}"]["fix"] == (
        "GRANT MODIFY, SELECT ON TABLE `cat`.`sch`.`tr_otel_annotations` TO `sp-app-id`;"
    )
    assert c["USE_CATALOG on cat"]["ok"] is True


def test_unreadable_permissions_are_unknown_not_failed(boot):
    c = checks(boot, perms_error=True)
    assert c["USE_CATALOG on cat"]["ok"] is None
    assert c["USE_CATALOG on cat"]["fix"] == "GRANT USE CATALOG ON CATALOG `cat` TO `sp-app-id`;"


def test_an_experiment_without_unity_catalog_traces(boot):
    assert checks(boot, table_prefix=None)["Unity Catalog trace location"]["ok"] is False


def test_setup_needs_a_signed_in_user(boot):
    client, _, _ = boot()
    assert client.get(f"{API}/setup").status_code == 401


@pytest.mark.parametrize(
    "owners, user_privileges, expected",
    [
        ({ANN: ALICE}, {}, True),  # owns the table
        ({"cat": ALICE}, {}, True),  # owns the catalog above it
        ({}, {ANN: ["MANAGE"]}, True),  # has MANAGE
        ({}, {ANN: ["SELECT"]}, False),  # every owner is someone else, no MANAGE
    ],
)
def test_setup_says_whether_you_can_grant(boot, owners, user_privileges, expected):
    c = ann_check(boot, owners=owners, user_privileges=user_privileges)
    assert c["you_can_grant"] is expected
    if expected is False:
        assert c["owner"] == "someone@else.com"


@pytest.mark.parametrize("owners", [{ANN: "data-admins"}, "error"])
def test_setup_does_not_guess_when_it_cannot_tell(boot, owners):
    assert "you_can_grant" not in ann_check(boot, owners=owners)


def test_grant_needs_the_user_token(boot):
    client, fake, _ = boot()
    r = client.post(f"{API}/setup/grant", headers=ALICE_H)
    assert r.status_code == 401
    assert "sql user authorization scope" in r.json()["error"]
    assert fake.statements == []


def test_grant_runs_every_grant_as_the_user_to_the_app(boot):
    client, fake, _ = boot()
    r = client.post(f"{API}/setup/grant", headers=with_token())
    assert r.status_code == 200
    assert fake.statements == [
        (f"tok-{ALICE}", "GRANT USE CATALOG ON CATALOG `cat` TO `sp-app-id`"),
        (f"tok-{ALICE}", "GRANT USE SCHEMA ON SCHEMA `cat`.`sch` TO `sp-app-id`"),
        (f"tok-{ALICE}", "GRANT SELECT ON TABLE `cat`.`sch`.`tr_otel_spans` TO `sp-app-id`"),
        (f"tok-{ALICE}", "GRANT SELECT ON TABLE `cat`.`sch`.`tr_otel_logs` TO `sp-app-id`"),
        (f"tok-{ALICE}", "GRANT MODIFY, SELECT ON TABLE `cat`.`sch`.`tr_otel_annotations` TO `sp-app-id`"),
    ]
    assert all(x["ok"] for x in r.json()["results"])


def test_grant_reports_each_refused_grant(boot):
    client, _, _ = boot(FakeGateway(deny_statements=["tr_otel_annotations"]))
    bad = [x for x in client.post(f"{API}/setup/grant", headers=with_token()).json()["results"] if not x["ok"]]
    assert len(bad) == 1
    assert "MANAGE" in bad[0]["detail"]


@pytest.mark.parametrize("table_prefix", ["cat.sch.x` TO `evil`; --", "cat.sch.a b"])
def test_grant_rejects_an_unexpected_table_name(boot, table_prefix):
    client, fake, _ = boot(FakeGateway(table_prefix=table_prefix))
    assert client.post(f"{API}/setup/grant", headers=with_token()).status_code == 400
    assert fake.statements == []


@pytest.mark.parametrize(
    "path, text",
    [
        ("/", "Your review app is running"),
        ("/_review/review.js", "export const review"),
        ("/setup", "Review App setup"),
    ],
)
def test_pages_are_served_with_the_security_headers(boot, path, text):
    client, _, _ = boot()
    r = client.get(path)
    assert r.status_code == 200
    assert text in r.text
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
