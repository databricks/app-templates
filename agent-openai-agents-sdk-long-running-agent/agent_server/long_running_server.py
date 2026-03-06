"""Long-running agent server with Lakebase persistence and background mode."""

import asyncio
import inspect
import json
import logging
import time
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import HTTPException, Query, Request
from fastapi.responses import StreamingResponse

import mlflow
from mlflow.genai.agent_server import get_invoke_function, get_stream_function
from mlflow.pyfunc import ResponsesAgent
from mlflow.genai.agent_server.server import (
    AgentServer,
    RETURN_TRACE_HEADER,
    STREAM_KEY as MLFLOW_STREAM_KEY,
)
from mlflow.tracing.constant import SpanAttributeKey
from mlflow.genai.agent_server.utils import get_request_headers, set_request_headers

from agent_server.db import (
    append_message,
    create_response,
    get_messages,
    get_response,
    is_db_configured,
    update_response_status,
    update_response_trace_id,
)
from agent_server.settings import settings
from agent_server.utils import replace_fake_id

logger = logging.getLogger(__name__)

BACKGROUND_KEY = "background"


async def _deferred_mark_failed(
    response_id: str, delay: float = 2.0, reason: str = "Task timed out"
) -> None:
    """Mark a response as failed after a short delay.

    Runs as an independent asyncio task so the caller (``_task_scope``) can
    return immediately.  The delay lets the connection pool stabilise after
    a cancellation before we attempt new DB writes.  The DB work is bounded
    by ``cleanup_timeout_seconds`` so this task cannot hang indefinitely;
    the stale-run check in ``_handle_retrieve_request`` is the final safety
    net if this fails.
    """
    try:
        await asyncio.sleep(delay)

        async with asyncio.timeout(settings.cleanup_timeout_seconds):
            existing = await get_messages(response_id, after_sequence=None)
            next_seq = max((seq for seq, _, _ in existing), default=-1) + 1

            error_event = {
                "type": "error",
                "error": {
                    "message": reason,
                    "type": "server_error",
                    "code": "task_timeout",
                },
            }
            await append_message(response_id, next_seq, item=None, stream_event=error_event)
            await update_response_status(response_id, "failed")

        logger.info("Marked %s as failed (reason: %s)", response_id, reason)
    except TimeoutError:
        logger.error(
            "Timed out marking %s as failed; stale-run check will catch it",
            response_id,
        )
    except Exception:
        logger.exception(
            "Failed to mark %s as failed; stale-run check will catch it",
            response_id,
        )


def _sse_event(event_type: str, data: dict[str, Any] | str) -> str:
    """Format an SSE event per Open Responses spec: event must match type in body."""
    payload = data if isinstance(data, str) else json.dumps(data)
    return f"event: {event_type}\ndata: {payload}\n\n"


class LongRunningAgentServer(AgentServer):
    """AgentServer subclass adding background mode and retrieve endpoints."""

    def _setup_routes(self) -> None:
        """Register routes. Reuses parent's POST /invocations and POST /responses.

        Adds GET /retrieve/{id} and GET /responses/{id} for polling/streaming
        when DB is configured. Background mode is handled via overridden
        _handle_invocations_request.
        """
        super()._setup_routes()

        if not is_db_configured():
            logger.warning(
                "Database not configured. Background mode disabled."
            )
            return

        @self.app.get("/retrieve/{response_id}")
        @self.app.get("/responses/{response_id}")
        async def retrieve_endpoint(
            response_id: str,
            stream: bool = Query(False, description="Stream results as SSE"),
            starting_after: int = Query(0, ge=0, description="Resume from sequence number"),
        ):
            """Handle GET /responses/{id} and GET /retrieve/{id}.

            Polls or streams new messages from the database as the agent loop
            produces them. Clients use the response_id returned from
            POST /responses (with background=true) to retrieve results.
            """
            return await self._handle_retrieve_request(
                response_id,
                stream=stream,
                starting_after=starting_after,
            )

    async def _handle_invocations_request(
        self, request: Request
    ) -> dict[str, Any] | StreamingResponse:
        """Handle POST /responses and POST /invocations.

        Registered by the parent AgentServer for both routes. When
        background=true and DB is configured, returns a response_id
        immediately and starts the agent loop in the background.
        Otherwise delegates to standard invoke/stream handlers.
        """
        set_request_headers(dict(request.headers))

        try:
            data = await request.json()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON in request body: {e!s}")

        is_background = data.pop(BACKGROUND_KEY, False)
        is_streaming = data.pop(MLFLOW_STREAM_KEY, False)
        return_trace_id = (
            (get_request_headers().get(RETURN_TRACE_HEADER) or "").lower() == "true"
        )

        try:
            request_data = self.validator.validate_and_convert_request(data)
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid parameters for {self.agent_type}: {e}",
            )

        if is_background and is_db_configured():
            return await self._handle_background_request(
                request_data, is_streaming, return_trace_id
            )

        if is_streaming:
            return await self._handle_stream_request(request_data, return_trace_id)
        return await self._handle_invoke_request(request_data, return_trace_id)

    async def _handle_background_request(
        self,
        request_data: dict[str, Any],
        is_streaming: bool,
        return_trace_id: bool,
    ) -> dict[str, Any] | StreamingResponse:
        """Start a new conversation and return response_id immediately.

        Creates a DB record, spawns the agent loop via asyncio.create_task.
        When stream=true, streams response.created + all events from the same
        connection (Responses API compliant). Client uses GET /responses/{id}
        only for resumption when connection drops.
        """
        response_id = f"resp_{uuid.uuid4().hex[:24]}"
        await create_response(response_id, "in_progress")

        logger.debug(
            "Background response created",
            extra={"response_id": response_id, "stream": is_streaming},
        )

        response_obj: dict[str, Any] = {
            "id": response_id,
            "object": "response",
            "created_at": int(time.time()),
            "status": "in_progress",
            "error": None,
            "incomplete_details": None,
            "output": [],
            "metadata": {},
        }

        if is_streaming:
            asyncio.create_task(
                self._run_background_stream(
                    response_id, request_data, return_trace_id
                )
            )
            return await self._handle_retrieve_request(
                response_id,
                stream=True,
                starting_after=-1,
            )
        else:
            asyncio.create_task(
                self._run_background_invoke(
                    response_id, request_data, return_trace_id
                )
            )
            return response_obj

    @asynccontextmanager
    async def _task_scope(
        self, response_id: str, state: dict[str, Any]
    ) -> AsyncGenerator[None, None]:
        """Timeout + error handling wrapper for background tasks.

        Three layers protect against stuck tasks:
        1. ``asyncio.timeout`` cancels the task after ``task_timeout_seconds``.
        2. ``_deferred_mark_failed`` writes an error event + "failed" status
           after a short delay (bounded by its own ``asyncio.timeout``).
        3. The stale-run check in ``_handle_retrieve_request`` catches anything
           the above two missed on the next client poll.

        On unhandled exceptions the status update is attempted inline first,
        falling back to the deferred path if that fails.
        """
        try:
            async with asyncio.timeout(settings.task_timeout_seconds):
                yield
        except TimeoutError:
            logger.warning(
                "Task %s timed out after %ss",
                response_id,
                settings.task_timeout_seconds,
            )
            # Defer the DB status update to a separate task rather than
            # blocking here.  After cancellation, the pool connection may
            # be mid-reconnect at the C level (un-interruptible by asyncio).
            # The short delay lets the pool stabilise; the stale-run check
            # in _handle_retrieve_request acts as a final safety net.
            asyncio.create_task(
                _deferred_mark_failed(response_id, delay=settings.cleanup_timeout_seconds),
                name=f"deferred-fail-{response_id}",
            )
        except Exception as exc:
            logger.exception("Task %s failed: %s", response_id, exc)
            try:
                async with asyncio.timeout(settings.cleanup_timeout_seconds):
                    existing = await get_messages(response_id, after_sequence=None)
                    next_seq = max((seq for seq, _, _ in existing), default=-1) + 1
                    await append_message(
                        response_id,
                        next_seq,
                        item=None,
                        stream_event={
                            "type": "error",
                            "error": {
                                "message": str(exc),
                                "type": "server_error",
                                "code": "task_failed",
                            },
                        },
                    )
                    await update_response_status(response_id, "failed")
            except Exception:
                logger.exception(
                    "[error-cleanup] Immediate update failed for %s, deferring",
                    response_id,
                )
                asyncio.create_task(
                    _deferred_mark_failed(
                        response_id,
                        delay=settings.cleanup_timeout_seconds,
                        reason=str(exc),
                    ),
                    name=f"deferred-fail-{response_id}",
                )

    async def _run_background_stream(
        self,
        response_id: str,
        request_data: dict[str, Any],
        return_trace_id: bool = False,
    ) -> None:
        """Timeout-guarded wrapper around the streaming agent loop."""
        state: dict[str, Any] = {"seq": 0}
        async with self._task_scope(response_id, state):
            await self._do_background_stream(
                response_id, request_data, return_trace_id, state
            )

    async def _do_background_stream(
        self,
        response_id: str,
        request_data: dict[str, Any],
        return_trace_id: bool,
        state: dict[str, Any],
    ) -> None:
        """Run agent via stream_fn, persist each stream event as a message row, update status.

        ``state["seq"]`` is updated on every persisted event so _task_scope can
        append a terminal error at the correct sequence number on timeout.
        """
        stream_fn = get_stream_function()
        if stream_fn is None:
            await update_response_status(response_id, "failed")
            raise RuntimeError("No stream function registered; cannot run background stream")

        func_name = stream_fn.__name__
        all_chunks: list[dict[str, Any]] = []
        seq = 0

        with mlflow.start_span(name=f"{func_name}") as span:
            span.set_inputs(request_data)
            async for event in stream_fn(request_data):
                evt = self.validator.validate_and_convert_result(event, stream=True)
                evt = replace_fake_id(evt, response_id)

                all_chunks.append(evt)
                item = evt.get("item")
                evt_type = evt.get("type", "message")
                logger.debug(
                    "SSE event (background)",
                    extra={"response_id": response_id, "seq": seq, "type": evt_type},
                )
                await append_message(
                    response_id,
                    seq,
                    item=json.dumps(item) if item is not None else None,
                    stream_event=evt,
                )
                seq += 1
                state["seq"] = seq

            if self.agent_type == "ResponsesAgent":
                span.set_attribute(SpanAttributeKey.MESSAGE_FORMAT, "openai")
                span.set_outputs(
                    ResponsesAgent.responses_agent_output_reducer(all_chunks)
                )
            else:
                span.set_outputs(all_chunks)

            if return_trace_id:
                await append_message(
                    response_id,
                    seq,
                    stream_event={"trace_id": span.trace_id},
                )

        await update_response_status(response_id, "completed")
        logger.debug(
            "Background stream completed",
            extra={"response_id": response_id, "total_events": seq},
        )

    async def _run_background_invoke(
        self,
        response_id: str,
        request_data: dict[str, Any],
        return_trace_id: bool = False,
    ) -> None:
        """Timeout-guarded wrapper around the invoke agent loop."""
        state: dict[str, Any] = {"seq": 0}
        async with self._task_scope(response_id, state):
            await self._do_background_invoke(
                response_id, request_data, return_trace_id, state
            )

    async def _do_background_invoke(
        self,
        response_id: str,
        request_data: dict[str, Any],
        return_trace_id: bool,
        state: dict[str, Any],
    ) -> None:
        """Run agent via invoke_fn, persist each output item as a message row, update status.

        ``state["seq"]`` is updated after persisting so _task_scope can
        append a terminal error at the correct sequence number on timeout.
        """
        invoke_fn = get_invoke_function()
        if invoke_fn is None:
            await update_response_status(response_id, "failed")
            raise RuntimeError("No invoke function registered; cannot run background invoke")

        func_name = invoke_fn.__name__

        with mlflow.start_span(name=f"{func_name}") as span:
            span.set_inputs(request_data)
            if inspect.iscoroutinefunction(invoke_fn):
                result = await invoke_fn(request_data)
            else:
                result = invoke_fn(request_data)

            result = self.validator.validate_and_convert_result(result)
            if self.agent_type == "ResponsesAgent":
                span.set_attribute(SpanAttributeKey.MESSAGE_FORMAT, "openai")
            span.set_outputs(result)

        output = result.get("output", [])
        for i, item in enumerate(output):
            item_dict = item if isinstance(item, dict) else (item.model_dump() if hasattr(item, "model_dump") else {"content": str(item)})
            await append_message(
                response_id,
                i,
                item=json.dumps(item_dict),
                stream_event={"type": "response.output_item.done", "item": item_dict},
            )
            state["seq"] = i + 1
        if return_trace_id:
            await update_response_trace_id(response_id, span.trace_id)
        await update_response_status(response_id, "completed")
        logger.debug(
            "Background invoke completed",
            extra={"response_id": response_id, "output_items": len(output)},
        )

    async def _handle_retrieve_request(
        self,
        response_id: str,
        stream: bool,
        starting_after: int,
    ) -> dict[str, Any] | StreamingResponse:
        """Poll or stream messages from the database for a given response_id.

        If stream=true, yields SSE events as the agent loop writes messages.
        If stream=false, returns the full output when status is completed,
        or {"status": "in_progress"} while the agent is still running.
        """
        resp = await get_response(response_id)
        if resp is None:
            raise HTTPException(status_code=404, detail="Response not found")

        _, status, created_at, trace_id = resp

        if status == "in_progress" and (time.time() - created_at) > settings.task_timeout_seconds:
            logger.warning(
                "Stale in_progress run detected, marking as failed",
                extra={"response_id": response_id, "age_s": time.time() - created_at},
            )
            existing = await get_messages(response_id, after_sequence=None)
            next_seq = max((seq for seq, _, _ in existing), default=-1) + 1
            await append_message(
                response_id,
                next_seq,
                item=None,
                stream_event={
                    "type": "error",
                    "error": {
                        "message": "Task timed out",
                        "type": "server_error",
                        "code": "task_timeout",
                    },
                },
            )
            await update_response_status(response_id, "failed")
            status = "failed"

        logger.debug(
            "Retrieve request",
            extra={
                "response_id": response_id,
                "stream": stream,
                "starting_after": starting_after,
                "status": status,
            },
        )

        if stream:
            return StreamingResponse(
                self._stream_retrieve(response_id, starting_after),
                media_type="text/event-stream",
            )

        messages = await get_messages(response_id, after_sequence=None)
        if not messages and status == "in_progress":
            return {"id": response_id, "status": "in_progress"}
        if status == "completed" and messages:
            output = []
            for _, _, evt in messages:
                if evt and "item" in evt:
                    output.append(evt["item"])
            result: dict[str, Any] = {
                "id": response_id,
                "status": "completed",
                "output": output,
            }
            if trace_id:
                result["metadata"] = {"trace_id": trace_id}
            return result
        if status == "failed" and messages:
            for _, _, evt in messages:
                if evt and evt.get("type") == "error":
                    return {"id": response_id, "status": "failed", "error": evt.get("error")}
        return {"id": response_id, "status": status}

    async def _stream_retrieve(
        self,
        response_id: str,
        starting_after: int,
    ) -> AsyncGenerator[str, None]:
        poll_interval = settings.poll_interval_seconds
        last_seq = starting_after

        while True:
            logger.debug(
                "Poll iteration for %s (last_seq=%s)",
                response_id, last_seq,
            )
            resp = await get_response(response_id)
            if resp is None:
                logger.debug(
                    "SSE error event",
                    extra={"response_id": response_id, "error": "response_not_found"},
                )
                yield _sse_event(
                    "error",
                    {
                        "error": {
                            "message": "Response not found",
                            "type": "not_found",
                            "code": "response_not_found",
                        }
                    },
                )
                break

            _, status, _, _ = resp
            # When last_seq is 0 (start from beginning), use -1 so we include seq 0 (response.created)
            after_seq = last_seq if last_seq > 0 else -1
            messages = await get_messages(response_id, after_sequence=after_seq)

            for seq, _, evt in messages:
                if evt is not None:
                    evt["sequence_number"] = seq
                    event_type = evt.get("type", "message")
                    logger.debug(
                        "SSE event",
                        extra={"response_id": response_id, "seq": seq, "type": event_type},
                    )
                    yield _sse_event(event_type, evt)
                last_seq = seq

            if status == "completed":
                logger.debug(
                    "SSE stream ended",
                    extra={"response_id": response_id, "status": "completed"},
                )
                yield "data: [DONE]\n\n"
                break

            if status == "failed":
                logger.debug(
                    "SSE stream ended",
                    extra={"response_id": response_id, "status": "failed"},
                )
                break

            await asyncio.sleep(poll_interval)
