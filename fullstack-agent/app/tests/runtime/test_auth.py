"""Every route fails closed, one shared app client, application-ID actors."""

import re

import pytest

from runtime.routers import ROUTERS
from tests.conftest import (
    OTHER_USER,
    USER,
    headers_for,
)


def api_routes() -> list[tuple[str, str]]:
    """Every route the routers mount, with sample path parameters."""
    routes = []
    for module in ROUTERS:
        for route in module.router.routes:
            path = route.path.replace("{invocation_id}", "run-1")
            path = re.sub(r"\{[^}]+\}", "abc", path)
            routes += [(method, f"/api{path}") for method in sorted(route.methods)]
    return routes


@pytest.mark.parametrize(("method", "path"), api_routes())
def test_every_route_fails_closed_without_a_user_token(
    deployed, client, recorder, method, path
):
    response = client.request(
        method,
        path,
        headers={"X-Forwarded-Email": USER},
        json={"title": "Records"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "MCP_USER_AUTH_REQUIRED"
    assert recorder.modes == []


def test_a_route_fails_closed_without_the_forwarded_email(deployed, client, recorder):
    headers = headers_for(USER)
    del headers["X-Forwarded-Email"]

    response = client.get("/api/me", headers=headers)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "MCP_USER_IDENTITY_MISSING"
    assert recorder.modes == []


def test_every_caller_shares_one_app_client(deployed, client, recorder):
    for email in (USER, OTHER_USER):
        client.get("/api/sessions", headers=headers_for(email))

    assert recorder.modes == ["app"]


def test_the_api_accepts_application_id_actors_without_at_signs(
    deployed, client, recorder
):
    """The API handles service principal identities (UUIDs without @) correctly."""
    app_id = "86a1c8de-c1e3-4cd0-8b18-18cdefbf1234"
    response = client.get("/api/me", headers=headers_for(app_id, user=app_id))

    assert response.status_code == 200
    assert response.json()["email"] == app_id
    assert recorder.modes == ["user"]
