"""invoke_api_endpoint forwards only allowed headers and refuses others before any request."""

import json
import os
from unittest import mock

import pytest

SPEC = {"paths": {"/pet/{petId}": {"get": {}}}}

# Importing custom_server starts the app, which needs a connection name and downloads the
# spec from the UC volume.
with (
    mock.patch.dict(
        os.environ,
        {
            "UC_CONNECTION_NAME": "test-connection",
            "SPEC_VOLUME_PATH": "/Volumes/test/test/test",
            "SPEC_FILE_NAME": "spec.json",
        },
    ),
    mock.patch("databricks.sdk.WorkspaceClient") as workspace_client,
):
    workspace_client.return_value.files.download.return_value.contents.read.return_value = (
        json.dumps(SPEC).encode()
    )
    from custom_server.handlers import invoke_api_endpoint
    from custom_server.schemas import InvokeApiEndpointRequest


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("ALLOWED_FORWARD_HEADERS", raising=False)
    client = mock.Mock()
    client.serving_endpoints.http_request.return_value = mock.Mock(
        status_code=200, headers={}, text="{}", json=lambda: {}
    )
    monkeypatch.setattr("custom_server.handlers.load_openapi_spec", lambda: SPEC)
    monkeypatch.setattr(
        "custom_server.handlers.get_user_authenticated_workspace_client", lambda: client
    )
    return client


def invoke(headers):
    request = InvokeApiEndpointRequest(endpoint_path="/pet/10", http_method="GET", headers=headers)
    return invoke_api_endpoint(request)


def test_default_headers_are_forwarded(client):
    headers = {"Accept": "application/json", "If-None-Match": '"v1"'}
    assert invoke(headers).ok
    assert client.serving_endpoints.http_request.call_args.kwargs["headers"] == headers


@pytest.mark.parametrize(
    "name",
    ["X-HTTP-Method-Override", "X-Original-URL", "Authorization", "X-Auth-Key", "Notion-Version"],
)
def test_other_headers_are_refused_before_any_request(client, name):
    with pytest.raises(ValueError, match=f"Header '{name}' is not allowed"):
        invoke({name: "x"})
    client.serving_endpoints.http_request.assert_not_called()


def test_headers_in_allowed_forward_headers_are_forwarded(client, monkeypatch):
    monkeypatch.setenv("ALLOWED_FORWARD_HEADERS", "Notion-Version, x-api-version")
    headers = {"Notion-Version": "2022-06-28", "X-Api-Version": "2"}
    assert invoke(headers).ok
    assert client.serving_endpoints.http_request.call_args.kwargs["headers"] == headers
