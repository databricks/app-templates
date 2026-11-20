"""Tests for the virtual MCP server that run without a Databricks workspace: the AI
Gateway client is replaced by an in-memory fake with a few services' tools."""

import json
import os

os.environ["DATABRICKS_APP_NAME"] = "virtual-mcp-test"
os.environ["DATABRICKS_HOST"] = "https://example.cloud.databricks.com"
os.environ.pop("PGHOST", None)
os.environ["VIRTUAL_MCP_CONFIG"] = json.dumps(
    {
        "services": [
            {"name": "system.ai.github", "include_regex": "^(get|search)_"},
            {
                "name": "system.ai.slack",
                "include_tools": ["slack_send_message", "slack_search_channels"],
            },
            {"name": "system.ai.gmail"},
            {"name": "system.ai.broken"},
        ]
    }
)

import asyncio  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from server import app as app_module  # noqa: E402
from server import config, proxy, tool_index  # noqa: E402
from server.gateway import GatewayMcpClient, UpstreamError  # noqa: E402

TOKEN = "user-token"
AUTH = {"x-forwarded-access-token": TOKEN}

UPSTREAM_TOOLS = {
    "system.ai.github": [
        {"name": "search_pull_requests", "description": "Search GitHub pull requests by query."},
        {"name": "get_me", "description": "Get the authenticated GitHub user."},
        {"name": "create_issue", "description": "Open a new GitHub issue."},
    ],
    "system.ai.slack": [
        {"name": "slack_send_message", "description": "Send a message to a Slack channel."},
        {"name": "slack_search_channels", "description": "Find Slack channels by name."},
        {"name": "slack_delete_message", "description": "Delete a Slack message."},
    ],
}
NOT_SIGNED_IN = UpstreamError(-32042, "not signed in")
UNREACHABLE = UpstreamError(-32000, "ConnectError: connection refused")


class FakeGateway:
    """Stands in for GatewayMcpClient. Gmail behaves like a service the user hasn't
    signed in to, and "broken" like one that can't be reached."""

    calls: list[tuple[str, str, dict]] = []

    def __init__(self, token: str):
        assert token == TOKEN

    async def list_tools(self, service: str) -> list[dict]:
        if service == "system.ai.broken":
            raise UNREACHABLE
        if service not in UPSTREAM_TOOLS:
            raise NOT_SIGNED_IN
        return UPSTREAM_TOOLS[service]

    async def call_tool(self, service: str, tool: str, arguments: dict) -> dict:
        if service not in UPSTREAM_TOOLS:
            raise NOT_SIGNED_IN
        FakeGateway.calls.append((service, tool, arguments))
        return {"content": [{"type": "text", "text": f"ran {service}/{tool}"}]}

    async def aclose(self) -> None:
        pass


async def _no_credential_info(token: str, service: str):
    return None


def _no_embeddings(texts):
    raise ValueError("no embedding endpoint in tests")


@pytest.fixture(scope="module")
def client():
    # The MCP session managers can only start once per process, so share one client.
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(proxy, "GatewayMcpClient", FakeGateway)
        mp.setattr(app_module, "credential_state", _no_credential_info)
        mp.setattr(tool_index, "embed", _no_embeddings)
        with TestClient(app_module.application) as test_client:
            yield test_client


def _rpc(client: TestClient, path: str, method: str, params: dict | None = None, headers=AUTH):
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    resp = client.post(path, json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["result"]


def test_config_derives_unique_aliases_and_filters_tools():
    cfg = config.parse_config(
        {
            "services": [
                {"name": "main.tools.github"},
                {"name": "system.ai.github", "include_regex": "^get_"},
                {"name": "system.ai.slack", "include_tools": ["slack_send_message"]},
            ]
        },
        "test",
    )
    assert [s.alias for s in cfg.services] == ["github", "github2", "slack"]
    assert cfg.services[0].matches("anything")
    assert cfg.services[1].matches("get_me") and not cfg.services[1].matches("create_issue")
    assert cfg.services[2].matches("slack_send_message")
    assert not cfg.services[2].matches("slack_delete_message")


@pytest.mark.parametrize(
    "raw",
    [
        {},
        {"services": [{"alias": "no_name"}]},
        {"services": [{"name": "a.b.c", "include_regex": "("}]},
        {"services": [{"name": "a.b.c", "alias": "x"}, {"name": "d.e.f", "alias": "x"}]},
        {"services": [{"name": "a.b.c", "unknown_field": 1}]},
        {"services": [{"name": "x/../../2.0/clusters/delete?a.b"}]},
        {"services": [{"name": "only.two"}]},
        {"services": [{"name": "a.b.c", "alias": "my__gh"}]},
        {"services": [{"name": "a.b.c", "alias": "Bad-Alias"}]},
        {"services": [{"name": "a.b.c", "include_tools": "slack_send_message"}]},
        {"services": [{"name": "a.b.c", "include_regex": ["^get_"]}]},
        ["not", "an", "object"],
    ],
)
def test_config_rejects_invalid_documents(raw):
    with pytest.raises(ValueError):
        config.parse_config(raw, "test")


def test_bundled_config_is_valid():
    raw = json.loads(config.BUNDLED_CONFIG_PATH.read_text())
    assert config.parse_config(raw, "bundled").services


def test_index_page_is_served(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert "Virtual MCP Server" in resp.text


def test_api_requires_a_user_token(client):
    assert client.get("/api/services").status_code == 401


def test_services_report_sign_in_state_and_selected_tools(client):
    data = client.get("/api/services", headers=AUTH).json()
    by_alias = {s["alias"]: s for s in data["services"]}
    assert by_alias["github"]["state"] == "CONNECTED"
    assert {t["name"] for t in by_alias["github"]["tools"]} == {
        "github__search_pull_requests",
        "github__get_me",
    }
    assert {t["name"] for t in by_alias["slack"]["tools"]} == {
        "slack__slack_send_message",
        "slack__slack_search_channels",
    }
    assert by_alias["gmail"]["state"] == "NEEDS_LOGIN"
    assert by_alias["broken"]["state"] == "ERROR"
    assert "connection refused" in by_alias["broken"]["error"]
    assert data["login_url"] == "https://example.cloud.databricks.com/mcp-service-login"


def test_mcp_lists_the_merged_tools(client):
    names = {t["name"] for t in _rpc(client, "/mcp", "tools/list")["tools"]}
    assert names == {
        "github__search_pull_requests",
        "github__get_me",
        "slack__slack_send_message",
        "slack__slack_search_channels",
    }


def test_mcp_lists_nothing_without_a_user_token(client):
    assert _rpc(client, "/mcp", "tools/list", headers={})["tools"] == []


def test_mcp_call_routes_to_the_owning_service(client):
    FakeGateway.calls.clear()
    result = _rpc(client, "/mcp", "tools/call", {"name": "github__get_me", "arguments": {}})
    assert not result.get("isError")
    assert result["content"][0]["text"] == "ran system.ai.github/get_me"
    assert FakeGateway.calls == [("system.ai.github", "get_me", {})]


def test_mcp_call_rejects_a_tool_outside_the_selection(client):
    result = _rpc(client, "/mcp", "tools/call", {"name": "github__create_issue", "arguments": {}})
    assert result["isError"]
    assert "Unknown tool" in result["content"][0]["text"]


def test_mcp_call_explains_how_to_sign_in(client):
    result = _rpc(client, "/mcp", "tools/call", {"name": "gmail__gmail_search", "arguments": {}})
    assert result["isError"]
    assert "not signed in" in result["content"][0]["text"]
    assert "mcp-service-login?name=system.ai.gmail" in result["content"][0]["text"]


def test_search_server_lists_only_its_two_tools(client):
    tools = _rpc(client, "/mcp/search", "tools/list")["tools"]
    assert [t["name"] for t in tools] == ["search_tools", "call_tool"]
    assert "github, slack, gmail, broken" in tools[0]["description"]


@pytest.mark.parametrize(
    ("query", "best"),
    [
        ("post a message in a slack channel", "slack__slack_send_message"),
        ("find pull requests", "github__search_pull_requests"),
    ],
)
def test_search_tools_ranks_the_relevant_tool_first(client, query, best):
    result = _rpc(
        client, "/mcp/search", "tools/call", {"name": "search_tools", "arguments": {"query": query}}
    )
    hits = json.loads(result["content"][0]["text"])
    assert hits[0]["name"] == best
    assert "input_schema" in hits[0]


def test_search_server_call_tool_runs_the_named_tool(client):
    FakeGateway.calls.clear()
    params = {
        "name": "call_tool",
        "arguments": {"name": "slack__slack_send_message", "arguments": {"text": "hi"}},
    }
    result = _rpc(client, "/mcp/search", "tools/call", params)
    assert not result.get("isError")
    assert FakeGateway.calls == [("system.ai.slack", "slack_send_message", {"text": "hi"})]


def test_ui_search_and_call_endpoints(client):
    hits = client.get("/api/search", params={"q": "slack channel", "n": 2}, headers=AUTH).json()[
        "tools"
    ]
    assert len(hits) == 2
    called = client.post("/api/call", json={"name": "github__get_me"}, headers=AUTH).json()
    assert called == {
        "ok": True,
        "text": "ran system.ai.github/get_me",
        "error": None,
        "needs_login": False,
    }


def test_search_returns_only_tools_the_caller_can_list(client):
    # Indexed from another user's listing; this caller's github listing lacks it.
    tool_index.sync(
        [
            {
                "name": "github__delete_repository",
                "alias": "github",
                "description": "Delete a GitHub repository permanently.",
                "input_schema": {"type": "object"},
            }
        ]
    )
    hits = client.get("/api/search", params={"q": "delete repository", "n": 5}, headers=AUTH)
    assert "github__delete_repository" not in {t["name"] for t in hits.json()["tools"]}


def test_call_tool_accepts_arguments_sent_as_a_json_string(client):
    FakeGateway.calls.clear()
    params = {
        "name": "call_tool",
        "arguments": {"name": "slack__slack_send_message", "arguments": '{"text": "hi"}'},
    }
    result = _rpc(client, "/mcp/search", "tools/call", params)
    assert not result.get("isError")
    assert FakeGateway.calls == [("system.ai.slack", "slack_send_message", {"text": "hi"})]


def test_search_tools_tolerates_a_non_numeric_top_n(client):
    params = {"name": "search_tools", "arguments": {"query": "slack", "top_n": "five"}}
    result = _rpc(client, "/mcp/search", "tools/call", params)
    assert not result.get("isError")


def test_local_development_rejects_non_loopback_hosts(client, monkeypatch):
    monkeypatch.delenv("DATABRICKS_APP_NAME")
    assert client.get("/", headers={"host": "attacker.example"}).status_code == 403
    assert client.get("/", headers={"host": "localhost:8000"}).status_code == 200


# --------------------------------------------------------------------------- #
# GatewayMcpClient against a mock transport
# --------------------------------------------------------------------------- #


def _gateway(handler) -> GatewayMcpClient:
    return GatewayMcpClient(TOKEN, transport=httpx.MockTransport(handler))


def _jsonrpc_handler(reply):
    """Answer initialize with a session, then every other method with reply(body)."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        assert request.url.path == "/ai-gateway/mcp-services/system.ai.github"
        if body["method"] == "initialize":
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": body["id"], "result": {}},
                headers={"mcp-session-id": "s1"},
            )
        if body["method"].startswith("notifications/"):
            return httpx.Response(202)
        return reply(body)

    return handler


def test_gateway_lists_tools_from_an_event_stream():
    def reply(body):
        event = {"jsonrpc": "2.0", "id": body["id"], "result": {"tools": [{"name": "get_me"}]}}
        return httpx.Response(
            200,
            text=f"event: message\ndata: {json.dumps(event)}\n\n",
            headers={"content-type": "text/event-stream"},
        )

    tools = asyncio.run(_gateway(_jsonrpc_handler(reply)).list_tools("system.ai.github"))
    assert tools == [{"name": "get_me"}]


def test_gateway_reports_not_signed_in():
    def reply(body):
        error = {"code": -32042, "message": "sign in required"}
        return httpx.Response(401, json={"jsonrpc": "2.0", "id": body["id"], "error": error})

    with pytest.raises(UpstreamError) as e:
        asyncio.run(_gateway(_jsonrpc_handler(reply)).list_tools("system.ai.github"))
    assert e.value.needs_login


@pytest.mark.parametrize(
    "reply",
    [
        lambda body: httpx.Response(200, text="<html>not json</html>"),
        lambda body: httpx.Response(200, json=["not", "an", "object"]),
        lambda body: httpx.Response(
            200, json={"jsonrpc": "2.0", "id": body["id"], "error": "boom"}
        ),
        lambda body: httpx.Response(302, headers={"location": "/login"}),
    ],
)
def test_gateway_turns_malformed_replies_into_upstream_errors(reply):
    with pytest.raises(UpstreamError) as e:
        asyncio.run(_gateway(_jsonrpc_handler(reply)).list_tools("system.ai.github"))
    assert not e.value.needs_login


def test_gateway_turns_transport_errors_into_upstream_errors():
    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(UpstreamError, match="connection refused"):
        asyncio.run(_gateway(handler).list_tools("system.ai.github"))


# --------------------------------------------------------------------------- #
# Embedding failures
# --------------------------------------------------------------------------- #

TOOL = {
    "name": "slack__slack_send_message",
    "alias": "slack",
    "description": "Send a message to a Slack channel.",
    "input_schema": {"type": "object"},
}
VECTOR = [1.0] + [0.0] * (tool_index.EMBEDDING_DIM - 1)


class FlakyEmbedder:
    """Fails the first `failures` calls, then returns a fixed vector per text."""

    def __init__(self, failures: int):
        self.failures = failures
        self.calls = 0

    def __call__(self, texts):
        self.calls += 1
        if self.calls <= self.failures:
            raise ConnectionError("embedding endpoint unreachable")
        return [VECTOR for _ in texts]


@pytest.fixture
def fresh_index(monkeypatch):
    index = tool_index.MemoryIndex()
    monkeypatch.setattr(tool_index, "_index", index)
    monkeypatch.setattr(tool_index, "_embedding_retry_at", 0.0)
    return index


def _embedded(index) -> bool:
    return index.stored()[TOOL["name"]][1]


def test_a_failed_embedding_is_retried_on_a_later_sync(fresh_index, monkeypatch):
    embedder = FlakyEmbedder(failures=1)
    monkeypatch.setattr(tool_index, "embed", embedder)
    assert tool_index.sync([TOOL])["embedded"] == 0
    assert not _embedded(fresh_index)
    monkeypatch.setattr(tool_index, "_embedding_retry_at", 0.0)  # retry wait elapsed
    assert tool_index.sync([TOOL])["embedded"] == 1
    assert _embedded(fresh_index)


def test_embedding_is_not_retried_during_the_retry_wait(fresh_index, monkeypatch):
    embedder = FlakyEmbedder(failures=1)
    monkeypatch.setattr(tool_index, "embed", embedder)
    tool_index.sync([TOOL])
    tool_index.sync([TOOL])
    assert tool_index.search("send a slack message", 3, [TOOL["name"]])
    assert embedder.calls == 1


def test_search_falls_back_to_keywords_on_network_errors(fresh_index, monkeypatch):
    monkeypatch.setattr(tool_index, "embed", FlakyEmbedder(failures=99))
    tool_index.sync([TOOL])
    assert tool_index.search("slack message", 3, [TOOL["name"]])[0][0] == TOOL["name"]
