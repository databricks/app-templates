---
name: supervisor-api-background-mode
description: "Enable Supervisor API background mode for long-running agent tasks. Use when: (1) Agent needs to run tasks longer than HTTP timeout limits, (2) User says 'background mode', 'long-running', 'supervisor api', (3) Converting from streaming to background polling pattern, (4) Agent needs resilience to connection drops during execution."
---

# Supervisor API Background Mode

**Prerequisite:** Follow the **supervisor-api** skill first to set up the Supervisor API with hosted tools and permissions. This skill extends that setup with background mode support.

Background mode submits the request asynchronously (`background=True`), polls for completion, and streams the result back to the frontend. Use this when agent tasks may exceed HTTP timeout limits (complex multi-tool workflows, large data analysis, etc.).

## Before Starting

Use the `AskUserQuestion` tool to ask: "How often should the agent poll for background task completion?" with options:
- **Every 2 seconds** — Fast response times, good for interactive use
- **Every 10 seconds** — Balanced between responsiveness and API load
- **Every 30 seconds** — Lower API load, suitable for very long-running tasks

Use their answer to set `POLL_INTERVAL` in `agent_server/utils.py`.

## Architecture

```
Chat UI ──POST /api/chat──> Express ──streamText()──> Python @stream()
                                                        |
                                                        +-- responses.create(background=True, stream=False)
                                                        |   (returns response_id immediately)
                                                        |
                                                        +-- poll every 2s: responses.retrieve(id)
                                                        |   skip items with status queued/incomplete/in_progress
                                                        |   yield completed items
                                                        |
                                                        +-- convert items to stream events
                                                        |   (chunk text into word-based deltas)
                                                        |
Chat UI <──SSE stream──── Express <──stream──------+
```

## What Changes from the Base Supervisor API

| Aspect | Base Supervisor API | Background Mode |
|--------|-------------------|-----------------|
| `responses.create()` | `stream=True` or `stream=False` | `background=True, stream=False` |
| Response | Immediate result or SSE stream | Returns `response_id` immediately |
| Result retrieval | Direct from response | Poll `responses.retrieve(id)` every 2s |
| Streaming to frontend | Native SSE from API | Simulated streaming (chunked text deltas) |
| Client pattern | Single `DatabricksOpenAI` | Dual-client: `AsyncDatabricksOpenAI` for create + plain `AsyncOpenAI` for poll |
| Timeout | HTTP request timeout | No timeout — polls until terminal status |

## Step 1: Add additional dependency

Add `openai` to `pyproject.toml` (already a transitive dependency of `databricks-openai`, but pinned here to ensure minimum version for `responses.retrieve()` support):
```toml
dependencies = [
    ...
    "openai>=1.70.0",
]
```

## Step 2: Add `agent_server/utils.py`

This replaces the base Supervisor API's simple `responses.create()` call with a dual-client setup, polling loop, and streaming conversion.

**Dual-client pattern** (critical): Use `AsyncDatabricksOpenAI` with `use_ai_gateway=True` for `responses.create()` — this routes requests through the Supervisor API. Use a plain `AsyncOpenAI` for `responses.retrieve()` to avoid gRPC metadata overflow errors that occur when Databricks auth headers are sent on polling calls.

```python
import asyncio
import logging
from typing import AsyncGenerator, Optional
from uuid import uuid4

import openai
from databricks.sdk import WorkspaceClient
from databricks_openai import AsyncDatabricksOpenAI
from mlflow.genai.agent_server import get_request_headers
from mlflow.types.responses import ResponsesAgentRequest, ResponsesAgentStreamEvent

POLL_INTERVAL = 2.0  # seconds between polls
INITIAL_POLL_DELAY = 1.0  # delay before first poll

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def get_session_id(request: ResponsesAgentRequest) -> str | None:
    if request.context and request.context.conversation_id:
        return request.context.conversation_id
    if request.custom_inputs and isinstance(request.custom_inputs, dict):
        return request.custom_inputs.get("session_id")
    return None


def create_supervisor_client(
    workspace_client: WorkspaceClient | None = None,
) -> tuple[AsyncDatabricksOpenAI, openai.AsyncOpenAI]:
    """
    Create two clients:
    - AsyncDatabricksOpenAI for responses.create() (handles Databricks auth)
    - Plain AsyncOpenAI for responses.retrieve() (avoids gRPC metadata overflow)
    """
    workspace_client = workspace_client or WorkspaceClient()
    # use_ai_gateway=True routes requests through the Supervisor API
    db_client = AsyncDatabricksOpenAI(
        workspace_client=workspace_client, use_ai_gateway=True
    )
    host = workspace_client.config.host.rstrip("/")
    auth_headers = workspace_client.config.authenticate()
    token = auth_headers.get("Authorization", "").replace("Bearer ", "")
    poll_client = openai.AsyncOpenAI(
        base_url=f"{host}/api/2.0/mas",
        api_key=token,
    )
    return db_client, poll_client


async def poll_background_response(
    client: openai.AsyncOpenAI,
    response_id: str,
) -> AsyncGenerator[dict, None]:
    """
    Poll a background response until terminal status (completed/failed/cancelled).
    Yields new output items as they appear. Skips incomplete items
    that the API returns while the response is still in_progress.
    """
    seen_item_count = 0
    poll_count = 0

    logger.info(
        f"[poll] Starting polling for response_id={response_id}, "
        f"interval={POLL_INTERVAL}s"
    )
    await asyncio.sleep(INITIAL_POLL_DELAY)

    while True:
        poll_count += 1
        logger.info(f"[poll] Poll #{poll_count} for response_id={response_id}")
        response = await client.responses.retrieve(response_id)
        status = response.status

        current_items = response.output or []
        new_items = len(current_items) - seen_item_count
        logger.info(
            f"[poll] status={status}, total_items={len(current_items)}, "
            f"new_items={new_items}"
        )

        if new_items > 0:
            for item in current_items[seen_item_count:]:
                item_dict = (
                    item.model_dump() if hasattr(item, "model_dump") else item
                )
                # Skip incomplete items -- they'll appear as completed on a later poll
                item_status = item_dict.get("status", "")
                if item_status in ("queued", "incomplete", "in_progress"):
                    logger.info(
                        f"[poll] Skipping incomplete item: "
                        f"type={item_dict.get('type')}, status={item_status}"
                    )
                    continue
                logger.info(
                    f"[poll] Yielding item: type={item_dict.get('type')}, "
                    f"id={item_dict.get('id')}"
                )
                yield item_dict
            seen_item_count = len(current_items)

        if status == "completed":
            logger.info(
                f"[poll] Response completed after {poll_count} polls, "
                f"{seen_item_count} total items"
            )
            return
        elif status in ("failed", "cancelled"):
            error_msg = (
                getattr(response, "error", None)
                or f"Background response {status}"
            )
            logger.error(f"[poll] Response {status}: {error_msg}")
            raise RuntimeError(f"Background response {status}: {error_msg}")

        logger.info(f"[poll] Waiting {POLL_INTERVAL}s before next poll...")
        await asyncio.sleep(POLL_INTERVAL)


def _chunk_text(text: str, chunk_size: int = 3) -> list[str]:
    """Split text into word-based chunks for streaming."""
    words = text.split(" ")
    chunks = []
    for i in range(0, len(words), chunk_size):
        chunk = " ".join(words[i : i + chunk_size])
        if i + chunk_size < len(words):
            chunk += " "
        chunks.append(chunk)
    return chunks


def output_item_to_stream_events(
    item: dict,
) -> list[ResponsesAgentStreamEvent]:
    """Convert a Responses API output item to stream events.

    For message items, text is chunked into small word-based deltas to simulate
    streaming on the frontend, since background mode returns the full text at once.
    """
    events = []
    item_type = item.get("type")
    item_id = item.get("id", str(uuid4()))

    if item_type == "message":
        for content_part in item.get("content", []):
            if content_part.get("type") == "output_text":
                text = content_part.get("text", "")
                for chunk in _chunk_text(text):
                    events.append(
                        ResponsesAgentStreamEvent(
                            type="response.output_text.delta",
                            item_id=item_id,
                            content_index=0,
                            delta=chunk,
                        )
                    )
        events.append(
            ResponsesAgentStreamEvent(
                type="response.output_item.done",
                item=item,
            )
        )
    else:
        # function_call, function_call_output, or other types
        events.append(
            ResponsesAgentStreamEvent(
                type="response.output_item.done",
                item=item,
            )
        )

    return events
```

## Step 3: Update `agent_server/agent.py`

Replace the base Supervisor API handlers with async background mode handlers. The key differences from the base skill:
- Use `async` handlers (required for polling)
- Pass `background=True, stream=False` to `responses.create()`
- Poll with `poll_background_response()` instead of reading the response directly
- Convert output items to stream events with `output_item_to_stream_events()`

Include your `TOOLS` list from the **supervisor-api** skill's Step 2 if you have hosted tools.

```python
import logging
from typing import AsyncGenerator

import mlflow
from databricks.sdk import WorkspaceClient
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import (
    create_supervisor_client,
    get_session_id,
    output_item_to_stream_events,
    poll_background_response,
)

mlflow.openai.autolog()
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)
logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

MODEL = "databricks-claude-sonnet-4"
SYSTEM_INSTRUCTIONS = "You are a helpful assistant."
TOOLS = [...]  # Your hosted tools from supervisor-api Step 2


def build_input(request: ResponsesAgentRequest) -> list[dict]:
    return [i.model_dump() for i in request.input]


@invoke()
async def invoke_handler(
    request: ResponsesAgentRequest,
) -> ResponsesAgentResponse:
    if session_id := get_session_id(request):
        mlflow.update_current_trace(
            metadata={"mlflow.trace.session": session_id}
        )

    workspace_client = WorkspaceClient()
    db_client, poll_client = create_supervisor_client(workspace_client)

    logger.info(f"[invoke] Submitting background request with model={MODEL}")
    response = await db_client.responses.create(
        model=MODEL,
        instructions=SYSTEM_INSTRUCTIONS,
        input=build_input(request),
        tools=TOOLS,
        background=True,
        stream=False,
    )
    logger.info(
        f"[invoke] Background request submitted: "
        f"id={response.id}, status={response.status}"
    )

    output_items = []
    async for item in poll_background_response(poll_client, response.id):
        logger.info(
            f"[invoke] Received output item: "
            f"type={item.get('type')}, id={item.get('id')}"
        )
        output_items.append(item)

    logger.info(f"[invoke] Complete: {len(output_items)} output items")
    return ResponsesAgentResponse(output=output_items)


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    if session_id := get_session_id(request):
        mlflow.update_current_trace(
            metadata={"mlflow.trace.session": session_id}
        )

    workspace_client = WorkspaceClient()
    db_client, poll_client = create_supervisor_client(workspace_client)

    logger.info(f"[stream] Submitting background request with model={MODEL}")
    response = await db_client.responses.create(
        model=MODEL,
        instructions=SYSTEM_INSTRUCTIONS,
        input=build_input(request),
        tools=TOOLS,
        background=True,
        stream=False,
    )
    logger.info(
        f"[stream] Background request submitted: "
        f"id={response.id}, status={response.status}"
    )

    async for item in poll_background_response(poll_client, response.id):
        events = output_item_to_stream_events(item)
        logger.info(
            f"[stream] Received item type={item.get('type')}, "
            f"emitting {len(events)} stream events"
        )
        for event in events:
            yield event
    logger.info("[stream] Complete")
```

## Key Gotchas

### 1. Incomplete items during `in_progress`

While the response status is `in_progress`, the Supervisor API may return output items that are not yet complete (their `status` field will be `queued`, `incomplete`, or `in_progress`). These partial items may have `id: None` and will cause Pydantic validation errors in `ResponsesAgentStreamEvent` and `ResponsesAgentResponse`. **Always check the item's `status` field and skip items that aren't `completed`.**

### 2. Dual-client pattern is required

`AsyncDatabricksOpenAI(use_ai_gateway=True)` is what routes requests through the Supervisor API. However, using this client for both `create()` and `retrieve()` causes gRPC metadata overflow errors on polling calls due to extra Databricks auth headers. Use a plain `AsyncOpenAI` client (with extracted token) for `responses.retrieve()`.

### 3. Simulated streaming for the frontend

The chat frontend expects SSE streaming events. Since background mode currently returns the full text at once, `output_item_to_stream_events()` chunks text into 3-word deltas to simulate a streaming experience. Streaming will be supported soon to fix this.

### 4. No timeout on polling

The polling loop runs indefinitely until a terminal status (`completed`, `failed`, `cancelled`). There is no max poll time — this is intentional for long-running background tasks. The frontend chat proxy also has no explicit timeout enforced in code.

## Testing

### Test background mode directly against the Supervisor API

```bash
# Get auth
export DATABRICKS_HOST=$(databricks auth env --profile <PROFILE> | grep DATABRICKS_HOST | cut -d= -f2)
export DATABRICKS_TOKEN=$(databricks auth env --profile <PROFILE> | grep DATABRICKS_TOKEN | cut -d= -f2)

# Submit background request with a Genie space tool
curl -s "${DATABRICKS_HOST}/api/2.0/serving-endpoints/<MODEL>/invocations" \
  -H "Authorization: Bearer ${DATABRICKS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<MODEL>",
    "input": [{"role": "user", "content": "What were the top 5 products by revenue last quarter?"}],
    "tools": [
      {
        "type": "genie_space",
        "genie_space": {
          "description": "Query sales and revenue data",
          "space_id": "<genie-space-id>"
        }
      }
    ],
    "background": true,
    "stream": false
  }'

# Poll (use the id from above)
curl -s "${DATABRICKS_HOST}/api/2.0/mas/responses/<RESPONSE_ID>" \
  -H "Authorization: Bearer ${DATABRICKS_TOKEN}"
```

### Test locally via the agent server

```bash
uv run start-app --no-ui

# In another terminal:
curl -X POST http://localhost:8000/invocations \
  -H "Content-Type: application/json" \
  -H "x-forwarded-access-token: <YOUR_TOKEN>" \
  -d '{
    "input": [{"role": "user", "content": [{"type": "input_text", "text": "Hello"}]}]
  }'
```

### Example Expected log output

```
INFO:agent_server.agent:[stream] Submitting background request with model=databricks-claude-sonnet-4
INFO:agent_server.agent:[stream] Background request submitted: id=resp_xxx, status=queued
INFO:agent_server.utils:[poll] Starting polling for response_id=resp_xxx, interval=2.0s
INFO:agent_server.utils:[poll] Poll #1: status=in_progress, total_items=0, new_items=0
INFO:agent_server.utils:[poll] Waiting 2.0s before next poll...
INFO:agent_server.utils:[poll] Poll #2: status=completed, total_items=1, new_items=1
INFO:agent_server.utils:[poll] Yielding item: type=message, id=msg_xxx
INFO:agent_server.utils:[poll] Response completed after 2 polls, 1 total items
INFO:agent_server.agent:[stream] Received item type=message, emitting N stream events
INFO:agent_server.agent:[stream] Complete
```
