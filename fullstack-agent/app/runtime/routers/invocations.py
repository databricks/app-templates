"""Stop a running invocation."""

from fastapi import APIRouter

from agent.cancellation import stop_run
from runtime.auth import SignedIn
from runtime.schemas import StopRequest

router = APIRouter()


@router.post("/invocations/{invocation_id}/cancel")
def stop_invocation(
    invocation_id: str, body: StopRequest, caller: SignedIn
) -> dict[str, bool]:
    """Stop run after its current turn if it runs on this instance."""
    store_session_id = caller.store_session_id(body.session_id)
    return {"stopped": stop_run(store_session_id, invocation_id)}
