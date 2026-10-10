"""The agent's HTTP surface — a from-scratch FastAPI app, framework-free and SDK-agnostic.

``build_app`` wires the endpoints to two handlers with a generic contract:

    invoke_handler(request: dict) -> dict
    stream_handler(request: dict) -> AsyncGenerator[dict]

Nothing here is OpenAI- or LangGraph-specific — the agent SDK lives entirely behind those handlers
(see ``agent/agent.py``). So this file is identical across agent templates; only the handlers differ.
Request/response bodies are plain Responses-shaped dicts (``input`` list + optional ``session_id``).
Endpoints:

- ``POST /invocations`` and ``POST /responses`` — run a turn. ``stream: true`` returns an SSE stream
  (``data: {...}`` frames ending with ``data: [DONE]``); ``background: true`` returns a ``resp_...``
  id immediately and runs the turn in the background.
- ``GET /responses/{id}`` — poll a background run's status/result.
- ``GET /health`` — liveness.

Every request is wrapped in an MLflow span, so tracing works when configured.

Background runs are tracked by ``agent/mason/background.py``'s ``BackgroundRuns`` — an in-memory,
single-process stand-in by default (not durable); see that module for the durability swap.
"""

import asyncio
import json
from collections.abc import AsyncGenerator, Awaitable, Callable

import mlflow
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from agent.mason.background import BackgroundRuns

# Request keys that control transport; stripped before the request reaches the handler.
_STREAM_KEY = "stream"
_BACKGROUND_KEY = "background"
_MESSAGE_FORMAT_ATTR = "mlflow.message.format"
_TRACE_NAME_TAG = "mlflow.traceName"

InvokeHandler = Callable[[dict], Awaitable[dict]]
StreamHandler = Callable[[dict], AsyncGenerator[dict, None]]


def _sse(data: dict | str) -> str:
    return f"data: {json.dumps(data) if isinstance(data, dict) else data}\n\n"


def build_app(invoke_handler: InvokeHandler, stream_handler: StreamHandler) -> FastAPI:
    """Build the FastAPI app wiring the endpoints to the agent's invoke/stream handlers."""
    app = FastAPI(title="Agent Server")
    runs = BackgroundRuns()

    async def _invoke(request: dict) -> dict:
        with mlflow.start_span(name="invoke_handler") as span:
            mlflow.update_current_trace(tags={_TRACE_NAME_TAG: "invoke_handler"})
            span.set_inputs(request)
            result = await invoke_handler(request)
            span.set_attribute(_MESSAGE_FORMAT_ATTR, "openai")
            span.set_outputs(result)
            return result

    async def _stream(request: dict) -> AsyncGenerator[str, None]:
        with mlflow.start_span(name="stream_handler") as span:
            mlflow.update_current_trace(tags={_TRACE_NAME_TAG: "stream_handler"})
            span.set_inputs(request)
            chunks: list[dict] = []
            try:
                async for chunk in stream_handler(request):
                    chunks.append(chunk)
                    yield _sse(chunk)
                span.set_attribute(_MESSAGE_FORMAT_ATTR, "openai")
                span.set_outputs(chunks)
            except Exception as e:  # surface the error in-band, then close the stream
                yield _sse({"error": str(e)})
            yield _sse("[DONE]")

    async def _run_background(response_id: str, request: dict) -> None:
        try:
            runs.complete(response_id, await _invoke(request))
        except Exception as e:
            runs.fail(response_id, str(e))

    async def _handle(request: Request):
        data = await request.json()
        is_stream = bool(data.pop(_STREAM_KEY, False))
        is_background = bool(data.pop(_BACKGROUND_KEY, False))

        if is_background:
            response_id = runs.create()
            # Fire-and-forget; the task updates `runs` when it finishes. Non-durable (in-memory).
            asyncio.create_task(_run_background(response_id, data))
            return JSONResponse({"id": response_id, "status": "in_progress"})
        if is_stream:
            return StreamingResponse(_stream(data), media_type="text/event-stream")
        return JSONResponse(await _invoke(data))

    app.add_api_route("/invocations", _handle, methods=["POST"])
    app.add_api_route("/responses", _handle, methods=["POST"])

    @app.get("/responses/{response_id}")
    async def retrieve(response_id: str):
        run = runs.get(response_id)
        if run is None:
            return JSONResponse({"error": "unknown response id"}, status_code=404)
        if run["status"] == "completed":
            return JSONResponse({"id": response_id, "status": "completed", **run["output"]})
        return JSONResponse({"id": response_id, "status": run["status"], "error": run["error"]})

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
