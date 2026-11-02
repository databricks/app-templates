import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from databricks.sdk import WorkspaceClient


@dataclass(frozen=True)
class RequestContext:
    """What tools need: two clients (user/app), run_id, activity, and reads."""

    client_for: Callable[[str], WorkspaceClient]
    emit: Callable[[dict[str, Any]], Awaitable[int]]
    session_id: str
    run_id: str
    activity: list[dict[str, Any]] = field(default_factory=list, compare=False)
    reads: list[str] = field(default_factory=list, compare=False)

    async def user_name(self) -> str:
        """Return the signed-in user's name, as Databricks reports it for the token."""
        me = await asyncio.to_thread(self.client_for("user").current_user.me)
        return me.user_name

    async def tool_event(
        self, tool: str, identity: str, target: str, outcome: str, **details: Any
    ) -> None:
        """Emit and store tool event with timestamp for Activity record."""
        event = {
            "type": "tool_event",
            "tool": tool,
            "identity": identity,
            "target": target,
            "outcome": outcome,
            "at": datetime.now(UTC).isoformat(timespec="milliseconds"),
            **details,
        }
        sequence = await self.emit(event)
        self.activity.append({**event, "activity_id": f"{self.run_id}:{sequence}"})
