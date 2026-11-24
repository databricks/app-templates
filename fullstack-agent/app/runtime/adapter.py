"""Translate Agent Bricks invocations into agent runs and confirmations."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from functools import partial
from typing import Any

import mlflow
from agents import MaxTurnsExceeded, ModelRefusalError
from databricks_agentkit import InvocationContext
from databricks_agentkit.openai import session_store
from databricks_agentkit.runtime.auth import AuthError
from fastapi import FastAPI
from mlflow.entities import SpanType
from openai import APIError
from pydantic import ValidationError

from agent.activity import record_activity
from agent.agent import run_agent, send_trace_id
from agent.approvals import ConfirmationFailed, confirm
from agent.cancellation import was_stopped
from agent.compaction import compact
from agent.context import RequestContext
from agent.gateway import PolicyBlocked
from agent.models import Effort, Model, model_named
from agent.settings import settings
from agent.tools.actions import ACTIONS
from runtime.errors import MODEL_TURNS_EXCEEDED, model_reply
from runtime.schemas import InvocationInput
from runtime.stores import drop_last_turn, stored_events
from runtime.streaming import RunStream, now

NOT_REPLACEABLE = (
    "Only the last answer can be replaced, and not one that proposed a change. "
    "Send a new message instead."
)
NO_IMAGES = "model {model!r} doesn't read images. Send the question without them."
COMPACTED = (
    "I summarised our earlier messages, so I read less from now on. "
    "Your last two questions stay as they were."
)
NOTHING_TO_COMPACT = "This conversation is short, so there is nothing to summarise yet."
CONFIRMATION_FAILED = "The confirmation failed. Its error is on the run's trace."
DECISION_TEXT = {
    "approve": "I confirmed this change.",
    "reject": "I cancelled this change.",
}
logger = logging.getLogger(__name__)


async def invoke(
    value: Any,
    context: InvocationContext,
    *,
    stored_events: Callable[[str], Awaitable[list[dict[str, Any]]]],
) -> dict:
    """Handle chat message, decision, or compact command. Record Activity."""
    auth = getattr(context, "request_auth", None)
    if auth is None:
        raise AuthError(
            "MCP_USER_AUTH_REQUIRED", "This agent runs only as the signed-in user."
        )
    if not context.session_id:
        raise ValueError("session_id must be provided as a top-level invocation field.")
    payload = {"messages": value} if isinstance(value, list) else value
    if not isinstance(payload, dict):
        raise ValueError("input must be a message list or an object.")
    try:
        invocation_input = InvocationInput.model_validate(payload)
    except ValidationError as error:
        raise ValueError(error.errors()[0]["msg"]) from error
    request = RequestContext(
        client_for=auth.client_for,
        emit=context.emit,
        session_id=context.session_id,
        run_id=context.invocation_id,
    )
    try:
        if invocation_input.confirm is not None:
            events = await stored_events(context.session_id)
            return await answer_confirmation(invocation_input.confirm, request, events)
        if invocation_input.command == "compact":
            return await answer_compaction(request)
        model = model_named(invocation_input.model)
        if invocation_input.has_images and not model.images:
            raise ValueError(NO_IMAGES.format(model=model.id))
        if invocation_input.replace:
            await replace_last_turn(request, await stored_events(context.session_id))
        return await answer_messages(
            invocation_input.messages, request, model, invocation_input.effort
        )
    finally:
        await record_activity(request)


async def replace_last_turn(
    request: RequestContext, events: list[dict[str, Any]]
) -> None:
    """Remove last turn from transcript. Skip if it proposed a change."""
    starts = [
        index for index, event in enumerate(events) if event.get("type") == "received"
    ]
    turn = events[starts[-1] :] if starts else []
    if not turn or any("proposal_id" in event for event in turn):
        raise ValueError(NOT_REPLACEABLE)
    if any(event.get("tool") == "model" for event in turn):
        dropped = await asyncio.to_thread(
            drop_last_turn, request.client_for("app"), request.session_id
        )
        logger.info("Replaced the last turn", extra={"items": dropped})
    await request.emit({"type": "replaced"})


async def recover(value: Any, context: InvocationContext) -> dict:
    """Fail a run cut off by restart or redeploy; user credentials can't resume."""
    raise AuthError(
        "MCP_USER_AUTH_RECOVERY_UNSUPPORTED",
        "An interrupted run can't resume without the signed-in user. Send the "
        "message again.",
        500,
    )


async def answer_confirmation(
    decision: Any, request: RequestContext, events: list[dict[str, Any]]
) -> dict:
    """Run confirmation decision and record in transcript with own trace span.
    A failure raises without its error text, which only the span keeps."""
    if not isinstance(decision, dict):
        raise ValueError("confirm must be an object with proposal_id and decision.")
    choice = str(decision.get("decision"))
    failure: ConfirmationFailed | None = None
    with mlflow.start_span(name="confirm", span_type=SpanType.CHAIN) as span:
        span.set_inputs(decision)
        actor = await request.user_name()
        mlflow.update_current_trace(
            session_id=request.session_id,
            user=actor,
            metadata=settings().trace_metadata,
        )
        await send_trace_id(request)
        try:
            reply = await confirm(
                request, str(decision.get("proposal_id")), choice, events, ACTIONS
            )
        except ConfirmationFailed as error:
            reply, failure = error.reply, error
            span.record_exception(error)
        span.set_outputs(reply)
        message = {"role": "assistant", "content": reply}
        await session_store(request.session_id, actor).add_items(
            [{"role": "user", "content": DECISION_TEXT[choice]}, message]
        )
        await request.emit({"type": "message", "message": message})
    if failure is not None:
        raise ConfirmationFailed(CONFIRMATION_FAILED, failure.reply) from None
    return {"output": [message], "status": "completed"}


async def answer_compaction(request: RequestContext) -> dict:
    """Summarize conversation for shorter context. Send trace, reply, usage."""
    model = model_named(None)
    service = settings().model_service(model.id)
    stream = RunStream(request)
    with mlflow.start_span(name="compact", span_type=SpanType.CHAIN):
        mlflow.update_current_trace(
            session_id=request.session_id,
            user=await request.user_name(),
            metadata=settings().trace_metadata,
        )
        await send_trace_id(request)
        try:
            usage = await compact(request, model)
        except (APIError, PolicyBlocked, ModelRefusalError) as error:
            reply, outcome, status = model_reply(error)
            level = logging.WARNING if outcome == "denied" else logging.ERROR
            logger.log(level, "Model call failed", extra={"status": status})
            await request.tool_event("model", "user", service, outcome, status=status)
            await stream.answer(reply)
            return {"output": stream.answers, "status": "completed"}
    if usage is None:
        await stream.answer(NOTHING_TO_COMPACT)
        return {"output": stream.answers, "status": "completed"}
    await request.tool_event("model", "user", service, "allowed")
    await stream.answer(COMPACTED)
    await request.emit(
        {
            "type": "usage",
            "requests": 1,
            "input_tokens": usage.prompt_tokens,
            "output_tokens": usage.completion_tokens,
        }
    )
    return {"output": stream.answers, "status": "completed"}


async def answer_messages(
    messages: Any, request: RequestContext, model: Model, effort: Effort
) -> dict:
    """Run agent and stream events. Send received, stopped, usage."""
    if not isinstance(messages, list) or not messages:
        raise ValueError("input.messages must be a non-empty list of chat messages.")
    await request.emit({"type": "received", "at": now()})
    service = settings().model_service(model.id)
    stream = RunStream(request)
    model_answered = False
    result = None
    try:
        async with run_agent(
            messages, request=request, model=model, effort=effort
        ) as result:
            async for event in result.stream_events():
                if event.type == "run_item_stream_event":
                    if event.name == "tool_output":
                        await stream.tool_done(event.item.raw_item.get("call_id"))
                    continue
                if event.type != "raw_response_event":
                    continue
                if not model_answered:
                    model_answered = True
                    await request.tool_event("model", "user", service, "allowed")
                await stream.model_event(event.data)
            if was_stopped(request):
                await request.emit({"type": "stopped"})
    except MaxTurnsExceeded:
        logger.warning("Run reached its turn limit", extra={"status": "TURNS_EXCEEDED"})
        await request.tool_event(
            "model", "user", service, "failed", status="TURNS_EXCEEDED"
        )
        await stream.answer(MODEL_TURNS_EXCEEDED)
    except (APIError, PolicyBlocked, ModelRefusalError) as error:
        reply, outcome, status = model_reply(error)
        level = logging.WARNING if outcome == "denied" else logging.ERROR
        logger.log(level, "Model call failed", extra={"status": status})
        await request.tool_event("model", "user", service, outcome, status=status)
        await stream.answer(reply)
    if result is not None:
        usage = result.context_wrapper.usage
        await request.emit(
            {
                "type": "usage",
                "requests": usage.requests,
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "context_tokens": sum(
                    call.total_tokens for call in usage.request_usage_entries[-1:]
                ),
            }
        )
    return {"output": stream.answers, "status": "completed"}


def invocation_handler(app: FastAPI) -> Callable[[Any, InvocationContext], Any]:
    """The agent's invocation handler, reading stored events from `app`'s runtime."""
    return partial(invoke, stored_events=partial(stored_events, app))
