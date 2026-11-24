import json
import os
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Annotated

import httpx
import mlflow
import pytest
from agents import (
    RunContextWrapper,
    SQLiteSession,
    function_tool,
    set_trace_processors,
)
from agents.tool_context import ToolContext
from databricks.sdk.errors import NotFound
from databricks.sdk.service.agentkit import AgentKitAPI
from databricks_agentkit import DurableAgentServer
from databricks_agentkit.runtime.auth import RequestAuthContext
from databricks_agentkit.runtime.store import InMemoryRuntimeStore
from databricks_openai.utils import clients
from fastapi.testclient import TestClient
from mlflow.entities import Span, Trace
from pydantic import Field

from agent import agent as agent_module
from agent import statement_execution
from agent.agent import create_agent, run_agent
from agent.approvals import Action, proposal_tool, propose
from agent.context import RequestContext
from agent.gateway import GatewayOpenAI
from agent.models import model_named
from agent.procedures import Procedure
from agent.statement_execution import report_read_failure
from agent.tools import Step, all_tools
from agent.tools.actions import ACTIONS
from runtime import auth
from runtime.middleware import SecurityHeadersMiddleware
from runtime.routers import install_api

os.environ["APP_CATALOG"] = "test_catalog"
os.environ["APP_PROJECT"] = "test"
os.environ["APP_WAREHOUSE_ID"] = "wh-1"
os.environ["APP_VERSION"] = "test-version"
os.environ["APP_ENVIRONMENT"] = "test"
os.environ.setdefault("AGENTBRICKS_PROJECT_ROOT", str(Path(__file__).parents[1]))

USER = "user@example.com"
OTHER_USER = "other@example.com"
STEP = "Looking at your records"
PLATFORM_NAMES = ("Unity", "Databricks", "MCP", "SQL", "test_", "propose_")
STORE = "test-sessions"
SESSIONS_PATH = f"/api/2.0/agents/session-stores/{STORE}/sessions"
RENAME = {"record_id": "R-1001", "name": "Archive", "amount": "25.00"}
RENAME_TARGET = "test_catalog.test_ops.rename_record"
DEFAULT_MODEL = model_named(None)
TEST_ACTIONS = {
    "rename_record": Action(
        Procedure(
            "rename_record",
            ":record_id, :name, CAST(:amount AS DECIMAL(12, 2)), :idempotency_key",
        ),
        "Record renamed",
    )
}


def internal_names_in(text: str) -> list[str]:
    """Platform names and tool/action names the text mentions."""
    names = (*PLATFORM_NAMES, *(tool.name for tool in all_tools()), *ACTIONS)
    return [name for name in names if name.lower() in text.lower()]


@proposal_tool
async def propose_rename(
    ctx: RunContextWrapper[RequestContext],
    step: Step,
    record_id: Annotated[str, Field(pattern=r"^R-[0-9]{4}$")],
    name: Annotated[str, Field(max_length=40)],
    amount: Annotated[Decimal, Field(max_digits=12, decimal_places=2)],
) -> str:
    """Prepare a new name for one of the user's records, for them to confirm."""
    return await propose(
        ctx.context,
        "rename_record",
        {"record_id": record_id, "name": name, "amount": str(amount)},
    )


def fake_client(mode: str) -> SimpleNamespace:
    return SimpleNamespace(
        mode=mode,
        current_user=SimpleNamespace(me=lambda: SimpleNamespace(user_name=USER)),
    )


def request_for(session_id: str, recorder: SimpleNamespace) -> RequestContext:
    """A request whose clients and events are recorded on `recorder`."""

    async def emit(event: dict) -> int:
        recorder.events.append(event)
        return len(recorder.events)

    def client_for(mode: str) -> SimpleNamespace:
        recorder.modes.append(mode)
        return fake_client(mode)

    return RequestContext(
        client_for=client_for, emit=emit, session_id=session_id, run_id="run-1"
    )


@pytest.fixture(scope="session", autouse=True)
def trace_store(tmp_path_factory) -> None:
    """Keep the traces tests create in a temporary MLflow store."""
    mlflow.set_tracking_uri(f"sqlite:///{tmp_path_factory.mktemp('mlflow')}/mlflow.db")


@pytest.fixture
def recorder() -> SimpleNamespace:
    return SimpleNamespace(events=[], modes=[])


@pytest.fixture
def request_context(recorder: SimpleNamespace) -> RequestContext:
    return request_for("session-a", recorder)


def model_chunk(delta: dict, finish_reason: str | None = None) -> str:
    """One server-sent chat completion chunk, as the model service streams it."""
    body = {
        "id": "completion-1",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "sonnet_llm",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(body)}\n\n"


def asks_for(tool: str, arguments: dict) -> str:
    """A streamed model response that calls one tool."""
    call = {
        "index": 0,
        "id": "call_1",
        "type": "function",
        "function": {"name": tool, "arguments": json.dumps(arguments)},
    }
    return (
        model_chunk({"role": "assistant", "content": None, "tool_calls": [call]})
        + model_chunk({}, "tool_calls")
        + "data: [DONE]\n\n"
    )


def answers(text: str) -> str:
    """A streamed model response that answers in text."""
    return (
        model_chunk({"role": "assistant", "content": text})
        + model_chunk({}, "stop")
        + "data: [DONE]\n\n"
    )


def blocked_by_policy(text: str) -> str:
    """Format a policy-blocked response with databricks_service_policy field."""
    body = {
        "id": "completion-1",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "sonnet_llm",
        "choices": [
            {
                "index": 0,
                "delta": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "databricks_service_policy": {"reason": "Blocked by block-unsafe-content."},
    }
    return f"data: {json.dumps(body)}\n\ndata: [DONE]\n\n"


@pytest.fixture
def streaming_model(monkeypatch) -> SimpleNamespace:
    """Mock model service with `replies` and `bodies` list, using in-memory sessions."""
    model = SimpleNamespace(count=0, replies=[answers("Done.")], bodies=[])

    def respond(request: httpx.Request) -> httpx.Response:
        model.count += 1
        model.bodies.append(json.loads(request.content))
        body = model.replies.pop(0) if len(model.replies) > 1 else model.replies[0]
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=body
        )

    monkeypatch.setattr(
        clients,
        "_get_authorized_async_http_client",
        lambda *_: httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    sessions = {}
    monkeypatch.setattr(
        agent_module,
        "session_store",
        lambda session_id, actor: sessions.setdefault(
            session_id, SQLiteSession(session_id)
        ),
    )
    return model


def agent_request(
    run_id: str, recorder: SimpleNamespace | None = None
) -> RequestContext:
    """A request in session-a for user@example.com, as the agent run gets it."""
    user = SimpleNamespace(
        mode="user",
        config=SimpleNamespace(
            host="https://workspace.example.com",
            authenticate=lambda: {"Authorization": "Bearer user-token"},
        ),
        current_user=SimpleNamespace(me=lambda: SimpleNamespace(user_name=USER)),
    )
    events = recorder.events if recorder else []

    async def emit(event: dict) -> int:
        events.append(event)
        return len(events)

    return RequestContext(lambda mode: user, emit, "session-a", run_id)


@pytest.fixture
def agent_traces():
    """Trace agent runs with MLflow's OpenAI autolog, as the deployed app does."""
    mlflow.openai.autolog()
    yield
    mlflow.openai.autolog(disable=True)
    set_trace_processors([])


def build_agent(modes: list[str]):
    """Create an agent at low effort; record requested client modes."""

    def client_for(mode: str) -> SimpleNamespace:
        modes.append(mode)
        return SimpleNamespace(
            config=SimpleNamespace(
                host="https://workspace.example.com",
                authenticate=lambda: {"Authorization": "Bearer user-token"},
            )
        )

    async def emit(event: dict) -> int:
        return 0

    request = RequestContext(client_for, emit, "session-a", "run-1")
    client = GatewayOpenAI(
        workspace_client=request.client_for("user"), use_ai_gateway=True
    )
    return create_agent(request, client, DEFAULT_MODEL, "low")


@pytest.fixture
def records(monkeypatch) -> SimpleNamespace:
    """Replace use-case tools with a single read_records tool; returns rows or error."""
    source = SimpleNamespace(rows=[], error=None)

    @function_tool
    async def read_records(ctx: ToolContext[RequestContext], step: Step) -> str:
        """Read the user's records."""
        if source.error is not None:
            report_read_failure(source.error, "read_records", "records")
            return "Unavailable."
        return json.dumps(source.rows)

    monkeypatch.setattr(agent_module, "all_tools", lambda: [read_records])
    return source


@pytest.fixture
def tool_span(monkeypatch) -> SimpleNamespace:
    """Stand in for the trace span the Agents SDK opens around a tool call."""
    span = SimpleNamespace(error=None)
    span.set_error = lambda error: setattr(span, "error", error)
    monkeypatch.setattr(statement_execution, "get_current_span", lambda: span)
    return span


async def traced_run(streaming_model, *replies: str, consume=None) -> Trace:
    """Run the agent on one question with the model's `replies` and return its trace."""
    streaming_model.replies = [*replies, answers("Done.")]
    async with run_agent(
        [{"role": "user", "content": "Records?"}],
        request=agent_request("run-1", SimpleNamespace(events=[])),
        model=DEFAULT_MODEL,
        effort="low",
    ) as result:
        async for event in result.stream_events():
            if consume:
                consume(event)
    return mlflow.get_trace(mlflow.get_last_active_trace_id(), flush=True)


def spans_by_name(trace: Trace) -> dict[str, Span]:
    return {span.name: span for span in trace.data.spans}


def headers_for(email: str, user: str | None = None) -> dict[str, str]:
    return {
        "X-Forwarded-Access-Token": "user-token",
        "X-Forwarded-User": user or f"{email}@idp",
        "X-Forwarded-Email": email,
    }


def store_session_id(headers: dict[str, str], conversation_id: str) -> str:
    """The session ID the agent runtime gives this user's conversation."""
    return RequestAuthContext.from_headers(headers).namespace(
        "session", conversation_id
    )


class FakeSessionStore:
    """In-memory mock of the managed session store's REST API."""

    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.items: dict[str, list] = {}
        self.calls: list[tuple] = []

    def do(self, method, path, query=None, body=None, headers=None):
        self.calls.append((method, path, query, body))
        session_id, _, kind = path.removeprefix(SESSIONS_PATH).strip("/").partition("/")
        if not session_id:
            if method == "POST":
                session = {"session_id": query["session_id"], **body}
                self.sessions[session["session_id"]] = session
                return session
            return {"sessions": list(self.sessions.values())}
        if session_id not in self.sessions:
            raise NotFound("Session not found")
        if method == "DELETE":
            del self.sessions[session_id]
            self.items.pop(session_id, None)
            return {}
        if method == "PATCH":
            self.sessions[session_id] |= {"metadata": body["metadata"]}
            return self.sessions[session_id]
        if kind == "items":
            return {
                "session_items": [
                    {"item_id": str(index), "data": data}
                    for index, data in enumerate(self.items.get(session_id, []))
                ]
            }
        return self.sessions[session_id]


@pytest.fixture
def deployed(monkeypatch, recorder):
    """Mock deployed app with in-memory store and recorded clients."""
    store = FakeSessionStore()
    monkeypatch.setenv("DATABRICKS_APP_NAME", "agent-bricks-agent")
    monkeypatch.setenv("DATABRICKS_HOST", "https://workspace.example.com")
    monkeypatch.setenv("AGENT_SESSION_STORE", STORE)

    def client_for(self, mode: str) -> SimpleNamespace:
        recorder.modes.append(mode)
        cfg = SimpleNamespace(workspace_id=None)
        return SimpleNamespace(
            mode=mode,
            api_client=store,
            agent_kit=AgentKitAPI(SimpleNamespace(_cfg=cfg, do=store.do)),
            current_user=SimpleNamespace(
                me=lambda: SimpleNamespace(user_name=USER, display_name="User One")
            ),
        )

    monkeypatch.setattr(RequestAuthContext, "client_for", client_for)
    monkeypatch.setattr(auth, "workspace_client", lambda: client_for(None, "app"))
    auth.app_client.cache_clear()
    yield store
    auth.app_client.cache_clear()


@pytest.fixture
def runtime_store() -> InMemoryRuntimeStore:
    return InMemoryRuntimeStore()


async def answer_nothing(value, context) -> dict:
    return {"output": [], "status": "completed"}


@pytest.fixture
def client(runtime_store) -> Iterator[TestClient]:
    """The agent server with the API routes, its runtime started."""
    app = DurableAgentServer(runtime_store=runtime_store)
    app.add_middleware(SecurityHeadersMiddleware)
    app.invoke(answer_nothing)
    install_api(app)
    with TestClient(app) as client:
        yield client
