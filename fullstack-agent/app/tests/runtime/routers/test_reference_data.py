"""The bank's Rates endpoint, read as the app."""

from runtime.routers import reference_data as reference_data_routes
from tests.conftest import (
    USER,
    headers_for,
)


def test_products_are_read_as_the_app(deployed, client, monkeypatch):
    monkeypatch.setattr(
        reference_data_routes, "read_products", lambda client: [{"mode": client.mode}]
    )

    response = client.get("/api/products", headers=headers_for(USER))

    assert response.json() == [{"mode": "app"}]
