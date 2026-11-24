"""Human approval of writes the model proposes.
Propose shows a card; confirm runs the write procedure as the user."""

import asyncio
import hashlib
import logging
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, NoReturn

from agents import (
    FunctionTool,
    ModelBehaviorError,
    default_tool_error_function,
    function_tool,
)
from agents.function_schema import function_schema
from agents.tool import ToolFunction
from agents.tool_context import ToolContext
from pydantic import ValidationError

from agent.context import RequestContext
from agent.procedures import Procedure, ProcedureClient
from agent.settings import settings

logger = logging.getLogger(__name__)

PROPOSED = "Nothing has changed yet. The user sees this change on a card to confirm."
NOT_PREPARED = "Not prepared, so no card was shown: check {fields}."
NOT_FOUND = "We couldn't find that change. Nothing was changed."
ALREADY_CANCELLED = "This change was already cancelled. Nothing was changed."
ALREADY_DECIDED = "This change was already decided, so it can't be cancelled."
NOT_PERMITTED = "This change isn't permitted for you. Nothing was changed."
DECIDING_OUTCOMES = ("allowed", "denied", "rejected_by_user")
OUTCOME_UNKNOWN = (
    "We couldn't confirm whether this change went through. Use Try again; it won't "
    "be made twice."
)


@dataclass(frozen=True)
class Action:
    """A write the user approves: the procedure that makes it, and its done text."""

    procedure: Procedure
    done: str


@dataclass
class Proposal:
    """A proposed write from the session's stored events."""

    action: str
    arguments: dict[str, str]
    card: dict[str, str]
    outcome: str | None = None


def stored_proposal(events: list[dict[str, Any]], proposal_id: str) -> Proposal | None:
    """Find proposal by ID from session's stored events, or None if not found."""
    proposal = None
    for event in events:
        if event.get("proposal_id") != proposal_id:
            continue
        if event.get("type") == "confirmation_required" and "arguments" in event:
            proposal = Proposal(event["action"], event["arguments"], event["args"])
        elif (
            proposal is not None
            and event.get("type") == "tool_event"
            and event.get("outcome") in DECIDING_OUTCOMES
        ):
            proposal.outcome = event["outcome"]
    return proposal


def proposal_tool(function: ToolFunction[...]) -> FunctionTool:
    """Make a propose function a tool; validate arguments to name failures."""
    arguments = function_schema(function).params_pydantic_model

    def not_prepared(ctx: ToolContext[Any], error: Exception) -> str:
        if not isinstance(error, ModelBehaviorError):
            return default_tool_error_function(ctx, error)
        try:
            arguments.model_validate_json(ctx.tool_arguments)
        except ValidationError as invalid:
            failed = {
                str(problem["loc"][0]) for problem in invalid.errors() if problem["loc"]
            }
            fields = [name for name in arguments.model_fields if name in failed]
            return NOT_PREPARED.format(
                fields=", ".join(fields or arguments.model_fields)
            )
        return default_tool_error_function(ctx, error)

    return function_tool(function, failure_error_function=not_prepared)


async def propose(
    request: RequestContext,
    action: str,
    arguments: dict[str, str],
    details: dict[str, str] | None = None,
) -> str:
    """Show a confirmation card; emit event stored for later confirm retrieval."""
    proposal_id = str(uuid.uuid4())
    card = (details or {}) | arguments
    await request.emit(
        {
            "type": "confirmation_required",
            "proposal_id": proposal_id,
            "action": action,
            "args": card,
            "arguments": arguments,
        }
    )
    return PROPOSED


class ConfirmationFailed(Exception):
    """A failed confirmation: the raw error as its message, the user's `reply`."""

    def __init__(self, error: str, reply: str) -> None:
        super().__init__(error)
        self.reply = reply


def describe(error: BaseException) -> str:
    return str(error) or type(error).__name__


async def failed(
    request: RequestContext,
    action: str,
    target: str,
    reply: str,
    error: BaseException | str,
) -> NoReturn:
    """Record failed confirmation and raise with reply; no proposal_id."""
    text = error if isinstance(error, str) else describe(error)
    await request.tool_event(action, "user", target, "failed")
    raise ConfirmationFailed(text, reply) from (
        error if isinstance(error, BaseException) else None
    )


async def confirm(
    request: RequestContext,
    proposal_id: str,
    decision: str,
    events: list[dict[str, Any]],
    actions: Mapping[str, Action],
) -> str:
    """Run or cancel a proposed write. A failed call leaves the outcome unknown;
    Try again replays it with the same idempotency key."""
    if decision not in ("approve", "reject"):
        raise ValueError(
            f"confirm.decision must be 'approve' or 'reject', got {decision!r}."
        )
    proposal = stored_proposal(events, proposal_id)
    if proposal is None:
        return NOT_FOUND
    if proposal.outcome == "rejected_by_user":
        return ALREADY_CANCELLED
    action = actions[proposal.action]
    target = f"{settings().catalog}.{settings().ops_schema}.{action.procedure.name}"
    if decision == "reject":
        if proposal.outcome is not None:
            return ALREADY_DECIDED
        await request.tool_event(
            proposal.action, "user", target, "rejected_by_user", proposal_id=proposal_id
        )
        return "Cancelled. Nothing was changed."

    key = hashlib.sha256(f"{request.session_id}:{proposal_id}".encode()).hexdigest()

    client = request.client_for("user")
    started = time.monotonic()
    try:
        result = await asyncio.to_thread(
            ProcedureClient(
                client,
                settings().warehouse_id,
                settings().catalog,
                settings().ops_schema,
            ).call,
            action.procedure,
            {**proposal.arguments, "idempotency_key": key},
        )
    except Exception as error:
        logger.error(
            "Confirmation outcome unknown",
            extra={
                "action": proposal.action,
                "status": "OUTCOME_UNKNOWN",
                "error": type(error).__name__,
                "duration_ms": round((time.monotonic() - started) * 1000),
            },
        )
        await failed(request, proposal.action, target, OUTCOME_UNKNOWN, error)

    status = result.status
    fields = {
        "action": proposal.action,
        "status": status,
        "duration_ms": round((time.monotonic() - started) * 1000),
    }
    if result.reference:
        fields["reference"] = result.reference
    logger.info("Confirmation ended", extra=fields)
    if status in ("OK", "OK_REPLAYED"):
        await request.tool_event(
            proposal.action,
            "user",
            target,
            "allowed",
            proposal_id=proposal_id,
            status=status,
            reference=result.reference,
            acted_as=result.acted_as,
        )
        done = (
            "This change was already made" if status == "OK_REPLAYED" else action.done
        )
        # nosemgrep: directly-returned-format-string -- tool text, not a Flask response
        return f"{done}. Your reference is {result.reference}."

    tool_event_kwargs: dict[str, Any] = {
        "proposal_id": proposal_id,
        "status": status,
    }
    if status == "REJECTED" and result.message:
        tool_event_kwargs["error"] = result.message
    await request.tool_event(
        proposal.action,
        "user",
        target,
        "denied",
        **tool_event_kwargs,
    )
    if status == "DENIED":
        return NOT_PERMITTED
    # nosemgrep: directly-returned-format-string -- tool text, not a Flask response
    return f"{result.message} Nothing was changed."
