from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.frontend import frontend

BUNDLE = "console.log('app');\n" * 200
API_REPLY = {"rows": ["x" * 2000]}


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index.js").write_text(BUNDLE)
    (tmp_path / "index.html").write_text("<!doctype html><title>App</title>")
    app = FastAPI()

    @app.get("/api/large")
    def large() -> dict[str, list[str]]:
        return API_REPLY

    app.mount("/", frontend(tmp_path), name="frontend")
    return TestClient(app)


def test_the_frontend_bundle_is_gzipped_for_clients_that_accept_it(client):
    response = client.get("/assets/index.js", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert response.text == BUNDLE


def test_api_routes_are_not_compressed(client):
    response = client.get("/api/large", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert "content-encoding" not in response.headers
    assert response.json() == API_REPLY


def test_the_index_page_is_still_served(client):
    response = client.get("/", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert "App" in response.text
