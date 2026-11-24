"""The bank's Accounts endpoint, read as the customer."""

import pytest

from runtime.routers import user_data as user_data_routes
from tests.conftest import (
    USER,
    headers_for,
)


@pytest.fixture
def queries(monkeypatch) -> list[tuple[str, str]]:
    """Record each query as (client mode, statement) and return one row."""
    calls: list[tuple[str, str]] = []

    def run_query(client, statement):
        calls.append((client.mode, statement))
        return [{"mode": client.mode}]

    monkeypatch.setattr(user_data_routes, "run_query", run_query)
    return calls


def test_accounts_are_read_as_the_user(deployed, client, queries):
    response = client.get("/api/me/accounts", headers=headers_for(USER))

    assert response.json() == [{"mode": "user"}]
    assert queries == [("user", user_data_routes.query("accounts"))]
