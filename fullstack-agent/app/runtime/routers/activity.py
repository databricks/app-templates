"""The signed-in user's Activity pages."""

from typing import Any

from fastapi import APIRouter, HTTPException

from agent.activity import read_activity
from runtime import stores
from runtime.auth import SignedIn

router = APIRouter()


@router.get("/activity")
def activity(caller: SignedIn, before: str | None = None) -> dict[str, Any]:
    """One page of caller's Activity with conversation ID and title."""
    try:
        page = read_activity(caller.client_for("user"), before)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    listed = {
        caller.store_session_id(item["id"]): item for item in stores.listed(caller)
    }
    for row in page["rows"]:
        conversation = listed.get(row.pop("session_id"), {})
        row["conversation_id"] = conversation.get("id")
        row["conversation_title"] = conversation.get("title")
    return page
