"""
A2A (Agent-to-Agent) Protocol wrapper — HTTP+JSON/REST binding (v1.0).

Implements the A2A specification endpoints on top of the existing
MLflow Responses-API agent server so that *other* A2A-compatible agents
(or orchestrators) can discover and interact with this multi-agent
orchestrator through the standard A2A protocol.

Key endpoints exposed:
  GET  /.well-known/agent-card.json       → Agent Card discovery
  POST /a2a/message:send                  → Send message (blocking)
  POST /a2a/message:stream                → Send message (SSE streaming)
  GET  /a2a/tasks/{task_id}               → Get task status
  GET  /a2a/tasks                         → List tasks
  POST /a2a/tasks/{task_id}:cancel        → Cancel task

Reference: https://a2a-protocol.org/latest/specification/
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory task store (swap for Redis / DB in production)
# ---------------------------------------------------------------------------
_tasks: Dict[str, Dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# A2A Agent Card builder  (Section 8 / 4.4.1 of the spec)
# ---------------------------------------------------------------------------
def build_agent_card(
    *,
    name: str = "MultiAgentOrchestrator",
    description: str = (
        "Routes queries to chart/visualization, knowledge-base, "
        "code-analysis, and custom agents"
    ),
    base_url: str | None = None,
    skills: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    """Return an A2A v1.0 Agent Card (Section 4.4.1)."""
    url = base_url or os.getenv("A2A_BASE_URL", "http://localhost:8000")
    default_skills = [
        {
            "id": "structured-data",
            "name": "Structured Data & Visualization",
            "description": (
                "Query structured data via Genie spaces and generate charts, "
                "dashboards, bar graphs, trend analysis, and SQL-queryable data."
            ),
            "tags": ["sql", "charts", "visualization", "genie", "metrics"],
            "examples": [
                "Show me revenue by region as a bar chart",
                "What were Q4 sales trends?",
            ],
            "inputModes": ["text/plain"],
            "outputModes": ["text/plain", "application/json"],
        },
        {
            "id": "unstructured-data",
            "name": "Knowledge Base / Unstructured Data",
            "description": (
                "Search documents, PDFs, policies, SOPs, and knowledge bases. "
                "Use for RAG-based Q&A, document summarization, and extracting "
                "info from unstructured sources."
            ),
            "tags": ["rag", "documents", "knowledge", "pdf", "search"],
            "examples": [
                "Summarize the Q3 compliance report",
                "What does the HR policy say about remote work?",
            ],
            "inputModes": ["text/plain"],
            "outputModes": ["text/plain"],
        },
        {
            "id": "code-analysis",
            "name": "Code Analysis Agent",
            "description": (
                "Analyze codebases, explain code, generate code, fix bugs, "
                "and provide software-development assistance."
            ),
            "tags": ["code", "development", "analysis", "bugs"],
            "examples": [
                "Explain the login module in our repo",
                "Find bugs in this function",
            ],
            "inputModes": ["text/plain"],
            "outputModes": ["text/plain"],
        },
        {
            "id": "custom-logic",
            "name": "Custom Business Logic",
            "description": (
                "Route to a model serving endpoint for master prompts, "
                "custom business calculations, or domain-specific operations."
            ),
            "tags": ["custom", "business", "prompt", "model"],
            "examples": [
                "Generate a master prompt for onboarding",
                "Run the compliance check workflow",
            ],
            "inputModes": ["text/plain"],
            "outputModes": ["text/plain"],
        },
    ]

    return {
        "name": name,
        "description": description,
        "supportedInterfaces": [
            {
                "url": f"{url}/a2a",
                "protocolBinding": "HTTP+JSON",
                "protocolVersion": "1.0",
            }
        ],
        "provider": {
            "organization": "Gilead Sciences",
            "url": url,
        },
        "version": "1.0.0",
        "capabilities": {
            "streaming": True,
            "pushNotifications": False,
        },
        "defaultInputModes": ["text/plain", "application/json"],
        "defaultOutputModes": ["text/plain", "application/json"],
        "skills": skills or default_skills,
    }


# ---------------------------------------------------------------------------
# Timestamp / task helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _make_task(
    task_id: str,
    context_id: str,
    state: str = "TASK_STATE_SUBMITTED",
    message: dict | None = None,
    artifacts: list | None = None,
) -> Dict[str, Any]:
    task: Dict[str, Any] = {
        "id": task_id,
        "contextId": context_id,
        "status": {
            "state": state,
            "timestamp": _now_iso(),
        },
    }
    if message:
        task["status"]["message"] = message
    if artifacts:
        task["artifacts"] = artifacts
    return task


def _json_compact(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Core: invoke the real orchestrator agent (blocking)
# ---------------------------------------------------------------------------

async def _invoke_orchestrator(user_text: str, session_id: str | None = None) -> str:
    """Call into the MLflow @invoke handler registered in agent.py."""
    from mlflow.types.responses import ResponsesAgentRequest

    from agent_server.agent import invoke_handler

    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": user_text}],
    )

    response = await invoke_handler(request)

    # Extract text from the ResponsesAgentResponse output items
    parts: list[str] = []
    for item in response.output:
        # OutputMessage → item.content list of ContentPart
        if hasattr(item, "content"):
            for cp in item.content:
                if hasattr(cp, "text"):
                    parts.append(cp.text)
        elif hasattr(item, "text"):
            parts.append(item.text)
    return "\n".join(parts) if parts else str(response.output)


# ---------------------------------------------------------------------------
# Streaming variant
# ---------------------------------------------------------------------------

async def _stream_orchestrator(user_text: str, task_id: str, context_id: str):
    """Yield SSE ``data:`` lines from the streaming orchestrator."""
    from mlflow.types.responses import ResponsesAgentRequest

    from agent_server.agent import stream_handler

    request = ResponsesAgentRequest(
        input=[{"role": "user", "content": user_text}],
    )

    # 1) Emit initial Task (working)
    task = _make_task(task_id, context_id, "TASK_STATE_WORKING")
    _tasks[task_id] = task
    yield f"data: {_json_compact({'task': task})}\n\n"

    # 2) Stream artifact chunks
    collected: list[str] = []
    try:
        async for event in stream_handler(request):
            if isinstance(event, dict):
                text_chunk = ""
                item = event.get("item")
                if isinstance(item, dict):
                    for c in item.get("content", []):
                        if isinstance(c, dict) and "text" in c:
                            text_chunk = c["text"]
                if text_chunk:
                    collected.append(text_chunk)
                    yield f"data: {_json_compact(_artifact_event(task_id, context_id, text_chunk))}\n\n"
    except Exception as exc:
        logger.exception("A2A streaming error: %s", exc)
        err = _status_event(task_id, context_id, "TASK_STATE_FAILED", str(exc))
        _tasks[task_id]["status"] = err["statusUpdate"]["status"]
        yield f"data: {_json_compact(err)}\n\n"
        return

    # 3) Emit completed
    full_text = "".join(collected) or "Task completed."
    completed = _make_task(
        task_id,
        context_id,
        "TASK_STATE_COMPLETED",
        artifacts=[
            {
                "artifactId": str(uuid4()),
                "name": "result",
                "parts": [{"text": full_text}],
            }
        ],
    )
    _tasks[task_id] = completed
    yield f"data: {_json_compact(_status_event(task_id, context_id, 'TASK_STATE_COMPLETED'))}\n\n"


def _artifact_event(task_id: str, context_id: str, text: str) -> dict:
    return {
        "artifactUpdate": {
            "taskId": task_id,
            "contextId": context_id,
            "artifact": {
                "artifactId": str(uuid4()),
                "parts": [{"text": text}],
            },
            "append": True,
            "lastChunk": False,
        }
    }


def _status_event(
    task_id: str, context_id: str, state: str, error_msg: str | None = None
) -> dict:
    status: dict = {"state": state, "timestamp": _now_iso()}
    if error_msg:
        status["message"] = {
            "role": "ROLE_AGENT",
            "messageId": str(uuid4()),
            "parts": [{"text": f"Error: {error_msg}"}],
        }
    return {"statusUpdate": {"taskId": task_id, "contextId": context_id, "status": status}}


# ---------------------------------------------------------------------------
# FastAPI endpoint registration
# ---------------------------------------------------------------------------

def add_a2a_endpoints(app: FastAPI, agent_card: Dict[str, Any] | None = None):
    """Mount all A2A HTTP+JSON/REST endpoints onto an existing FastAPI app."""
    card = agent_card or build_agent_card()

    # ── Agent Card discovery (Section 8.2) ────────────────────────────
    @app.get("/.well-known/agent-card.json")
    async def get_agent_card():
        return JSONResponse(
            content=card,
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # ── Send Message — blocking (Section 11.3.1 / 3.1.1) ─────────────
    @app.post("/a2a/message:send")
    async def a2a_send_message(request: Request):
        body = await request.json()
        message = body.get("message", {})
        user_text = _extract_text(message)

        if not user_text:
            return _a2a_error(400, "INVALID_ARGUMENT", "Message must contain at least one text part")

        task_id = str(uuid4())
        context_id = message.get("contextId") or str(uuid4())
        _tasks[task_id] = _make_task(task_id, context_id, "TASK_STATE_WORKING")

        try:
            result_text = await _invoke_orchestrator(user_text, session_id=context_id)
            completed = _make_task(
                task_id,
                context_id,
                "TASK_STATE_COMPLETED",
                artifacts=[
                    {
                        "artifactId": str(uuid4()),
                        "name": "result",
                        "parts": [{"text": result_text}],
                    }
                ],
            )
            _tasks[task_id] = completed
            return JSONResponse(content={"task": completed})
        except Exception as exc:
            logger.exception("A2A SendMessage error: %s", exc)
            failed = _make_task(
                task_id,
                context_id,
                "TASK_STATE_FAILED",
                message={
                    "role": "ROLE_AGENT",
                    "messageId": str(uuid4()),
                    "parts": [{"text": f"Error: {exc}"}],
                },
            )
            _tasks[task_id] = failed
            return JSONResponse(content={"task": failed})

    # ── Send Streaming Message (Section 11.3.1 / 3.1.2) ──────────────
    @app.post("/a2a/message:stream")
    async def a2a_stream_message(request: Request):
        body = await request.json()
        message = body.get("message", {})
        user_text = _extract_text(message)

        if not user_text:
            return _a2a_error(400, "INVALID_ARGUMENT", "Message must contain at least one text part")

        task_id = str(uuid4())
        context_id = message.get("contextId") or str(uuid4())

        return StreamingResponse(
            _stream_orchestrator(user_text, task_id, context_id),
            media_type="text/event-stream",
        )

    # ── Get Task (Section 11.3.2 / 3.1.3) ────────────────────────────
    @app.get("/a2a/tasks/{task_id}")
    async def a2a_get_task(task_id: str):
        task = _tasks.get(task_id)
        if not task:
            return _a2a_error(404, "TASK_NOT_FOUND", f"Task '{task_id}' not found")
        return JSONResponse(content=task)

    # ── List Tasks (Section 11.3.2 / 3.1.4) ──────────────────────────
    @app.get("/a2a/tasks")
    async def a2a_list_tasks(
        contextId: str | None = None,
        status: str | None = None,
        pageSize: int = 50,
    ):
        results = list(_tasks.values())
        if contextId:
            results = [t for t in results if t.get("contextId") == contextId]
        if status:
            results = [t for t in results if t.get("status", {}).get("state") == status]
        results.sort(
            key=lambda t: t.get("status", {}).get("timestamp", ""),
            reverse=True,
        )
        page = results[:pageSize]
        return JSONResponse(
            content={
                "tasks": page,
                "totalSize": len(results),
                "pageSize": pageSize,
                "nextPageToken": "",
            }
        )

    # ── Cancel Task (Section 11.3.2 / 3.1.5) ─────────────────────────
    @app.post("/a2a/tasks/{task_id}:cancel")
    async def a2a_cancel_task(task_id: str):
        task = _tasks.get(task_id)
        if not task:
            return _a2a_error(404, "TASK_NOT_FOUND", f"Task '{task_id}' not found")

        terminal = {"TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED"}
        if task.get("status", {}).get("state") in terminal:
            return _a2a_error(409, "TASK_NOT_CANCELABLE", "Task is already in a terminal state")

        task["status"] = {"state": "TASK_STATE_CANCELED", "timestamp": _now_iso()}
        return JSONResponse(content=task)

    logger.info("A2A protocol endpoints registered (HTTP+JSON/REST v1.0)")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_text(message: dict) -> str:
    """Pull user text from A2A message parts."""
    parts = message.get("parts", [])
    texts = []
    for p in parts:
        if isinstance(p, dict) and "text" in p:
            texts.append(p["text"])
    return " ".join(texts).strip()


def _a2a_error(status_code: int, reason: str, detail: str) -> JSONResponse:
    """Return an A2A-compliant error response (Section 11.6)."""
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": status_code,
                "status": reason,
                "message": detail,
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                        "reason": reason,
                        "domain": "a2a-protocol.org",
                    }
                ],
            }
        },
    )
