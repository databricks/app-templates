"""Stream one agent run to the app as it happens."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from time import monotonic
from typing import Any

from openai.types.responses import (
    Response,
    ResponseCompletedEvent,
    ResponseFunctionToolCall,
    ResponseOutputItemAddedEvent,
    ResponseOutputItemDoneEvent,
    ResponseReasoningSummaryPartDoneEvent,
    ResponseReasoningSummaryTextDeltaEvent,
    ResponseTextDeltaEvent,
)

from agent.context import RequestContext

DELTA_CHARACTERS = 40
DELTA_SECONDS = 0.1


@dataclass
class ModelResponse:
    """The model response being written: what was sent, and when its text began."""

    text: str = ""
    unsent: str = ""
    narrated: str = ""
    reasoning: str = ""
    reasoned: str = ""
    calls_tool: bool = False
    text_started_at: float | None = None


class RunStream:
    """Stream run events: text, narration, reasoning, status, and answer."""

    def __init__(self, request: RequestContext) -> None:
        self.request = request
        self.answers: list[dict] = []
        self.finished = 0
        self.response = ModelResponse()
        self.steps: set[str] = set()
        self.sent_at = float("-inf")
        self.started_at = monotonic()

    async def model_event(self, event: Any) -> None:
        """Handle one raw event of the model's streamed response."""
        if isinstance(event, ResponseTextDeltaEvent):
            await self.add_text(event.delta)
        elif isinstance(event, ResponseOutputItemAddedEvent):
            if event.item.type == "function_call":
                await self.start_calls()
        elif isinstance(event, ResponseOutputItemDoneEvent):
            if event.item.type == "function_call":
                await self.start_step(event.item)
        elif isinstance(event, ResponseReasoningSummaryTextDeltaEvent):
            self.response.reasoning += event.delta
            if self.is_due(len(self.response.reasoning) - len(self.response.reasoned)):
                await self.reason()
        elif isinstance(event, ResponseReasoningSummaryPartDoneEvent):
            await self.reason()
        elif isinstance(event, ResponseCompletedEvent):
            await self.finish(event.response)

    async def tool_done(self, call_id: str | None) -> None:
        """Mark a tool call's step done once its output is back."""
        if call_id in self.steps:
            await self.request.emit({"type": "step.done", "step": call_id, "at": now()})

    async def add_text(self, delta: str) -> None:
        response = self.response
        if response.text_started_at is None:
            response.text_started_at = monotonic()
        response.text += delta
        if response.calls_tool:
            if self.is_due(len(response.text) - len(response.narrated)):
                await self.narrate(response.text)
            return
        response.unsent += delta
        if self.is_due(len(response.unsent)):
            await self.send({"type": "delta", "content": response.unsent})
            response.unsent = ""

    async def start_calls(self) -> None:
        if not self.response.calls_tool:
            self.response.calls_tool = True
            self.response.unsent = ""
            await self.narrate(self.response.text)

    async def start_step(self, call: ResponseFunctionToolCall) -> None:
        await self.narrate(self.response.text)
        step = tool_arguments(call).get("step")
        if isinstance(step, str) and step.strip():
            self.steps.add(call.call_id)
            await self.request.emit(
                {
                    "type": "status",
                    "step": call.call_id,
                    "tool": call.name,
                    "text": step.strip(),
                    "at": now(),
                }
            )

    async def finish(self, response: Response) -> None:
        text = output_text(response)
        if any(item.type == "function_call" for item in response.output):
            await self.narrate(text)
        elif text:
            await self.answer(text, self.response.text_started_at)
        self.finished += 1
        self.response = ModelResponse()

    async def answer(self, text: str, started_at: float | None = None) -> None:
        """Send the answer with how long the work before it took."""
        answered_at = monotonic() if started_at is None else started_at
        seconds = round(answered_at - self.started_at)
        await self.request.emit({"type": "work.done", "seconds": seconds})
        message = {"role": "assistant", "content": text}
        await self.request.emit({"type": "message", "message": message})
        self.answers.append(message)

    async def narrate(self, text: str) -> None:
        if text and text != self.response.narrated:
            self.response.narrated = text
            await self.send(
                {"type": "narration", "id": self.finished + 1, "text": text}
            )

    async def reason(self) -> None:
        text = self.response.reasoning
        if text and text != self.response.reasoned:
            self.response.reasoned = text
            await self.send(
                {"type": "reasoning", "id": self.finished + 1, "text": text}
            )

    def is_due(self, unsent: int) -> bool:
        return unsent >= DELTA_CHARACTERS or monotonic() - self.sent_at >= DELTA_SECONDS

    async def send(self, event: dict) -> None:
        self.sent_at = monotonic()
        await self.request.emit(event)


def now() -> str:
    """The server's time in UTC, to the millisecond, as the app's events carry it."""
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def output_text(response: Response) -> str:
    return "".join(
        part.text
        for item in response.output
        if item.type == "message"
        for part in item.content
        if part.type == "output_text"
    )


def tool_arguments(call: ResponseFunctionToolCall) -> dict:
    try:
        arguments = json.loads(call.arguments or "{}")
    except json.JSONDecodeError:
        return {}
    return arguments if isinstance(arguments, dict) else {}
