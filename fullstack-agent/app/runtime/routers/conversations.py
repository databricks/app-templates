"""Create, list, open, rename and delete the signed-in user's conversations."""

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from runtime import stores
from runtime.auth import SignedIn
from runtime.schemas import ConversationTitle

STILL_ANSWERING = "The conversation is still answering. Delete it once it has finished."

router = APIRouter()


@router.post("/sessions", status_code=201)
def create_conversation(body: ConversationTitle, caller: SignedIn) -> dict[str, str]:
    return stores.create(caller, body.title)


@router.get("/sessions")
def list_conversations(caller: SignedIn) -> list[dict[str, str | None]]:
    return stores.listed(caller)


@router.get("/sessions/{conversation_id}")
async def conversation(
    conversation_id: str, request: Request, caller: SignedIn
) -> dict[str, Any]:
    """Return conversation with its runs, messages, and running invocation."""
    transcript = await asyncio.to_thread(stores.transcript, caller, conversation_id)
    session_id = caller.store_session_id(conversation_id)
    return transcript | {
        "runs": await stores.session_runs(request.app, session_id),
        "running": await stores.running_invocation(request.app, session_id),
    }


@router.patch("/sessions/{conversation_id}")
def rename_conversation(
    conversation_id: str, body: ConversationTitle, caller: SignedIn
) -> dict[str, str | None]:
    return stores.rename(caller, conversation_id, body.title)


@router.delete("/sessions/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str, request: Request, caller: SignedIn
) -> None:
    """Delete a caller's conversation; 409 if a run is still writing to it."""
    session = await asyncio.to_thread(stores.owned, caller, conversation_id)
    if await stores.running_invocation(request.app, session.session_id):
        raise HTTPException(409, STILL_ANSWERING)
    await asyncio.to_thread(stores.delete, caller, session)
