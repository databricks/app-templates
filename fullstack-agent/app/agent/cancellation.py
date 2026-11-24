"""The streaming runs of this process, so a user can stop one after its turn."""

from agents import RunResultStreaming

from agent.context import RequestContext

RUNNING: dict[tuple[str, str], RunResultStreaming] = {}
STOPPED: set[tuple[str, str]] = set()


def stop_run(session_id: str, run_id: str) -> bool:
    """Stop run after current turn. Return False if not found in this process."""
    result = RUNNING.get((session_id, run_id))
    if result is None:
        return False
    STOPPED.add((session_id, run_id))
    result.cancel(mode="after_turn")
    return True


def was_stopped(request: RequestContext) -> bool:
    """Whether `stop_run` ended the request's run."""
    return (request.session_id, request.run_id) in STOPPED
