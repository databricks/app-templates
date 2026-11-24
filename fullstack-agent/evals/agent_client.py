"""Ask deployed app as test users and record responses with full access checks."""

import json
import threading
import time
import uuid
from typing import Any

import httpx
import mlflow
from mlflow.entities import SpanType

INVOKE_TIMEOUT_SECONDS = 180


class TokenCapReached(RuntimeError):
    """The run spent its token cap, so no further trial starts."""


def sse_events(text: str) -> list[dict[str, Any]]:
    """The JSON payloads of a Server-Sent Events body, in order."""
    return [
        json.loads(line[5:])
        for line in text.splitlines()
        if line.startswith("data:") and line[5:].strip()
    ]


def record(events: list[dict[str, Any]], outputs: dict[str, Any]) -> None:
    """Add run's events to trial outputs as MLflow spans."""
    narration: dict[int, str] = {}
    for event in events:
        kind = event.get("type")
        if kind == "narration":
            narration[event["id"]] = event["text"]
        elif kind == "message" and event["message"]["role"] == "assistant":
            outputs["answers"].append(event["message"]["content"])
        elif kind == "tool_event":
            keys = ("tool", "target", "outcome", "status")
            tool = {key: event.get(key) for key in keys}
            outputs["tools"].append(tool)
            if tool["tool"] == "model":
                continue
            with mlflow.start_span(name=tool["tool"], span_type=SpanType.TOOL) as span:
                span.set_inputs({"target": tool["target"]})
                span.set_outputs({"outcome": tool["outcome"]})
        elif kind == "display":
            outputs["displays"].append(event["payload"])
        elif kind == "confirmation_required":
            card = {"action": event["action"], "arguments": event["arguments"]}
            outputs["proposals"].append(card)
            with mlflow.start_span(
                name=f"propose_{card['action']}", span_type=SpanType.TOOL
            ) as span:
                span.set_inputs(card["arguments"])
        elif kind == "usage":
            outputs["input_tokens"] += event["input_tokens"]
            outputs["output_tokens"] += event["output_tokens"]
        elif kind == "run.failed":
            outputs["failed_runs"] += 1
    outputs["narration"].extend(narration.values())


class AgentApp:
    """Ask deployed app as test users under one token cap."""

    def __init__(self, url: str, tokens: dict[str, str], max_tokens: int) -> None:
        self._url = f"{url}/api/invocations"
        self._tokens = tokens
        self.max_tokens = max_tokens
        self.spent = 0
        self._lock = threading.Lock()
        self._sessions: dict[str, str] = {}

    def invoke(self, user: str, session_id: str, text: str) -> list[dict]:
        """Send question and return run events, checking token cap."""
        with self._lock:
            if self.spent >= self.max_tokens:
                raise TokenCapReached(
                    f"The run spent {self.spent} of its {self.max_tokens} tokens. "
                    "Raise --max-tokens or run fewer cases."
                )
        response = httpx.post(
            self._url,
            headers={
                "Authorization": f"Bearer {self._tokens[user]}",
                "Accept": "text/event-stream",
                "X-Routing-Key": session_id,
            },
            json={
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "input": {"messages": [{"role": "user", "content": text}]},
                "stream": True,
            },
            timeout=INVOKE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        events = sse_events(response.text)
        with self._lock:
            self.spent += sum(
                event["input_tokens"] + event["output_tokens"]
                for event in events
                if event.get("type") == "usage"
            )
        return events

    def ask(self, user: str, turns: list[str]) -> dict[str, Any]:
        """Hold one conversation and return everything the user was sent."""
        outputs = new_outputs()
        session_id = str(uuid.uuid4())
        started = time.monotonic()
        for text in turns:
            record(self.invoke(user, session_id, text), outputs)
        outputs["seconds"] = round(time.monotonic() - started, 1)
        return outputs

    def ask_in_session(self, user: str, key: str, text: str) -> dict[str, Any]:
        """Send turn in simulated conversation, keeping session history."""
        session_id = self._sessions.setdefault(key, str(uuid.uuid4()))
        outputs = new_outputs()
        started = time.monotonic()
        record(self.invoke(user, session_id, text), outputs)
        outputs["seconds"] = round(time.monotonic() - started, 1)
        return outputs


def new_outputs() -> dict[str, Any]:
    """The empty record of a trial, which `record` fills from the app's events."""
    return {
        "answers": [],
        "narration": [],
        "displays": [],
        "tools": [],
        "proposals": [],
        "input_tokens": 0,
        "output_tokens": 0,
        "failed_runs": 0,
    }
