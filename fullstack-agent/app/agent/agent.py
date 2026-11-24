import asyncio
import os
import warnings
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from functools import partial
from typing import Any

import mlflow
from agents import (
    Agent,
    ModelRefusalError,
    ModelSettings,
    OpenAIChatCompletionsModel,
    RunConfig,
    Runner,
    RunResultStreaming,
    set_trace_processors,
)
from agents.mcp import MCPServerManager
from databricks_agentkit.openai import configure_tracing, mcp_servers, session_store
from databricks_openai.agents import McpServer
from mlflow.entities import SpanType

from agent.cancellation import RUNNING, STOPPED
from agent.context import RequestContext
from agent.gateway import GatewayOpenAI, PolicyBlocked
from agent.mcps import build_mcp_servers
from agent.models import Effort, Model, allowed_models
from agent.prompts import prompt
from agent.settings import settings
from agent.tools import all_tools
from agent.tools.display import RecordReads

MAX_TURNS = 10
MAX_TOKENS = 16_000
HISTORY_TURNS = 10
POLICY_BLOCKED_METADATA = {"app.status": "POLICY_BLOCKED"}

SUMMARIZED_THINKING = {"type": "adaptive", "display": "summarized"}
SERIALIZER_WARNING = (
    r"(?s)Pydantic serializer warnings:.*field_name='content'.*input_type=list"
)


def _claude(thinking: dict[str, str], effort: str | None = None) -> ModelSettings:
    output = {"output_config": {"effort": effort}} if effort else {}
    return ModelSettings(
        max_tokens=MAX_TOKENS, extra_body={"thinking": thinking, **output}
    )


EFFORTS = {
    "between_tools": {
        "low": _claude({"type": "between_tools"}),
        "medium": _claude(SUMMARIZED_THINKING, "low"),
        "high": _claude(SUMMARIZED_THINKING, "high"),
    },
    "adaptive": {
        "low": _claude(SUMMARIZED_THINKING, "low"),
        "medium": _claude(SUMMARIZED_THINKING, "medium"),
        "high": _claude(SUMMARIZED_THINKING, "high"),
    },
}


IMAGE_LEFT_OUT = {
    "type": "input_text",
    "text": "[An image the user attached earlier, which this model can't read]",
}


def without_images(item: dict[str, Any]) -> dict[str, Any]:
    """The item with each image it carries replaced by a line saying it was left out."""
    content = item.get("content")
    if not isinstance(content, list):
        return item
    parts = [
        IMAGE_LEFT_OUT if part.get("type") == "input_image" else part
        for part in content
    ]
    return {**item, "content": parts}


def _recent_history(
    history: list[Any], new_input: list[Any], *, images: bool
) -> list[Any]:
    """Keep the last HISTORY_TURNS user messages; cut at user messages only.
    Replace images with text if the model doesn't support them."""
    user_turns = [
        index for index, item in enumerate(history) if item.get("role") == "user"
    ]
    start = user_turns[-HISTORY_TURNS] if len(user_turns) >= HISTORY_TURNS else 0
    kept = history[start:] if images else map(without_images, history[start:])
    return [*kept, *new_input]


def run_config(model: Model) -> RunConfig:
    """The run's settings: no task or turn spans, and the history `model` may read."""
    return RunConfig(
        tracing={"include_task_and_turn_spans": False},
        session_input_callback=partial(_recent_history, images=model.images),
    )


def configure() -> None:
    """Validate settings, models, and enable tracing. Call once at startup.
    Ignores pydantic's warning on raw chunks MLflow traces, which quotes model text."""
    settings()
    allowed_models()

    if (
        os.getenv("DATABRICKS_APP_NAME")
        and os.getenv("DATABRICKS_AGENTBRICKS_RUNTIME_STORE_LOCAL", "").lower()
        == "true"
    ):
        raise ValueError(
            "DATABRICKS_APP_NAME must not be set when "
            "DATABRICKS_AGENTBRICKS_RUNTIME_STORE_LOCAL is true"
        )

    set_trace_processors([])
    configure_tracing()
    warnings.filterwarnings("ignore", message=SERIALIZER_WARNING, category=UserWarning)


def instructions() -> str:
    """The system prompt, from `prompts/system.md`."""
    return prompt("system")


async def send_trace_id(request: RequestContext) -> None:
    """Send the active trace's ID as a `trace` event for later client feedback."""
    trace_id = mlflow.get_active_trace_id()
    if trace_id is not None:
        await request.emit({"type": "trace", "trace_id": trace_id})


def create_agent(
    request: RequestContext,
    client: GatewayOpenAI,
    model: Model,
    effort: Effort,
    servers: list[McpServer] | None = None,
) -> Agent[RequestContext]:
    """Build agent with function tools and MCP servers. No free-form SQL tool."""
    return Agent(
        name="assistant",
        instructions=instructions(),
        model=OpenAIChatCompletionsModel(
            model=settings().model_service(model.id), openai_client=client
        ),
        model_settings=EFFORTS[model.reasoning][effort],
        tools=all_tools(),
        mcp_servers=servers or [],
        hooks=RecordReads(),
    )


@asynccontextmanager
async def run_agent(
    messages: list[Any], *, request: RequestContext, model: Model, effort: Effort
) -> AsyncIterator[RunResultStreaming]:
    """Run agent and expose streaming result. Bounded by MAX_TURNS and MAX_TOKENS.
    The run's own root span ends OK on a refusal by a service policy or the
    provider's content filter, with POLICY_BLOCKED in the trace's metadata, and the
    refusal still reaches the caller."""
    actor = await request.user_name()
    client = GatewayOpenAI(
        workspace_client=request.client_for("user"),
        use_ai_gateway=True,
    )
    servers = await mcp_servers(
        build_mcp_servers(), workspace_client_for=request.client_for
    )
    refusal: PolicyBlocked | ModelRefusalError | None = None
    async with MCPServerManager(servers, strict=True) as manager:
        with mlflow.start_span(name="question", span_type=SpanType.AGENT) as span:
            span.set_inputs(messages)
            result = Runner.run_streamed(
                create_agent(request, client, model, effort, manager.active_servers),
                messages,
                context=request,
                max_turns=MAX_TURNS,
                session=session_store(request.session_id, actor),
                run_config=run_config(model),
            )
            mlflow.update_current_trace(
                session_id=request.session_id,
                user=actor,
                metadata=settings().trace_metadata,
            )
            await send_trace_id(request)
            key = (request.session_id, request.run_id)
            RUNNING[key] = result
            try:
                yield result
                span.set_outputs(result.final_output)
            except (PolicyBlocked, ModelRefusalError) as error:
                refusal = error
                mlflow.update_current_trace(metadata=POLICY_BLOCKED_METADATA)
            finally:
                RUNNING.pop(key, None)
                STOPPED.discard(key)
                if not result.is_complete:
                    mlflow.update_current_trace(state="ERROR")
                    result.cancel()
                    with suppress(asyncio.CancelledError, Exception):
                        async for _ in result.stream_events():
                            pass
                await client.close()
    if refusal is not None:
        raise refusal
