"""Security headers on the API's and the frontend's responses."""

import importlib

import dotenv
import pytest
from fastapi.testclient import TestClient

CSP = (
    "default-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; frame-ancestors 'none'"
)


@pytest.fixture
def served_app(monkeypatch) -> TestClient:
    """The app `app.yaml` serves, without the local `.env`.
    No `with` block, so the runtime's lifespan doesn't start."""
    monkeypatch.setattr(dotenv, "load_dotenv", lambda **kwargs: False)
    return TestClient(importlib.import_module("runtime.main").app)


@pytest.mark.parametrize(
    ("path", "status"), [("/", 200), ("/favicon.svg", 200), ("/api/me", 401)]
)
def test_the_served_app_sends_security_headers(served_app, path, status):
    """Verify CSP, nosniff, Referrer-Policy and HSTS on the frontend and the API."""
    response = served_app.get(path)

    assert response.status_code == status
    assert response.headers["Content-Security-Policy"] == CSP
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "same-origin"
    assert response.headers["Strict-Transport-Security"] == "max-age=31536000"
