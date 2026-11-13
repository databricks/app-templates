"""The signed-in user's profile, the models a run may use, and no compare endpoint."""

from dataclasses import asdict

from agent.models import allowed_models
from tests.conftest import (
    USER,
    headers_for,
)


def test_me_reports_the_forwarded_email_and_user_identity(deployed, client, recorder):
    response = client.get("/api/me", headers=headers_for(USER))

    assert response.json() == {
        "email": USER,
        "user_name": USER,
        "display_name": "User One",
    }
    assert recorder.modes == ["user"]


def test_the_models_come_from_configuration_without_a_workspace_call(
    deployed, client, recorder
):
    response = client.get("/api/models", headers=headers_for(USER))

    assert response.json() == [asdict(model) for model in allowed_models()]
    assert response.json()[0]["id"] == "sonnet_llm"
    assert recorder.modes == []


def test_compare_endpoint_returns_404(deployed, client, recorder):
    response = client.get("/api/compare", headers=headers_for(USER))

    assert response.status_code == 404
    assert recorder.modes == []
