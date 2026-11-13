"""Frontend API routes under /api; failed reads return 403/504 with code."""

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse

from agent.statement_execution import QueryFailed, log_read_failure
from runtime.routers import (
    activity,
    conversations,
    feedback,
    invocations,
    reference_data,
    user_data,
    users,
)

ROUTERS = (
    users,
    user_data,
    invocations,
    activity,
    reference_data,
    conversations,
    feedback,
)


async def query_failed(request: Request, error: QueryFailed) -> JSONResponse:
    """Log read failure and return HTTP status and error code."""
    log_read_failure(error, {"route": request.scope["route"].path})
    status_codes = {"QUERY_TIMEOUT": 504, "PERMISSION_DENIED": 403}
    return JSONResponse(
        {"error": {"code": error.code, "status": error.code}},
        status_code=status_codes.get(error.code, 502),
    )


def install_api(app: FastAPI) -> None:
    """Add the frontend's API routes to the agent server."""
    api = APIRouter(prefix="/api")
    for module in ROUTERS:
        api.include_router(module.router)
    app.include_router(api)
    app.add_exception_handler(QueryFailed, query_failed)
