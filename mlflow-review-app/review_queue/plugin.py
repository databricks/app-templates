"""The review queue routes for a FastAPI app. Template-owned: customers do not edit this folder.

API routes are under /api/review-queue/... The browser reaches them through /_review/review.js.
Also serves /setup (the install check) and /_review/* (the client and the setup page's files).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Body, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .backend import ReviewBackend, ReviewError
from .gateway import MlflowGateway, UpstreamError
from .setup_checks import run_checks, run_grants

logger = logging.getLogger(__name__)
CLIENT_DIR = Path(__file__).parent / "client"

NO_GRANT_SCOPE = (
    "This app has no sql user authorization scope, so it cannot run the GRANTs as you. Run the GRANT "
    "statements above in a SQL editor, or add the sql scope in the app's user authorization settings "
    "and open the app again."
)


def reviewer(request: Request) -> str:
    """The reviewer is the user the Apps proxy signed in. The app is not reachable around the proxy."""
    email = request.headers.get("x-forwarded-email")
    if email:
        return email
    # Local runs only (no Apps runtime).
    dev_user = os.environ.get("REVIEW_APP_DEV_USER")
    if dev_user and not os.environ.get("DATABRICKS_APP_NAME"):
        return dev_user
    raise ReviewError("No signed-in reviewer.", 401)


class ReviewQueue:
    """Adds the review queue routes, /setup and the client to a FastAPI app.

    Args:
        experiment_id: Default: MLFLOW_EXPERIMENT_ID.
        warehouse_id: Default: DATABRICKS_WAREHOUSE_ID.
        queue_ids: Only these queues are shown. Default: REVIEW_QUEUE_IDS (comma-separated), or every queue.
        can_write: Who may save answers and set status from the browser (`review.saveAnswers`,
            `review.setStatus`). Default: every queue member. Return False to keep a reviewer's answers
            out of MLflow, for example when reviewers save drafts to your own database and an
            adjudicator saves the final answer.
        gateway: The MLflow and Databricks calls. Default: `MlflowGateway`. Tests pass a fake.
    """

    def __init__(
        self,
        *,
        experiment_id: str | None = None,
        warehouse_id: str | None = None,
        queue_ids: list[str] | None = None,
        can_write: Callable[[str, str], bool] | None = None,
        gateway: Any = None,
    ):
        if queue_ids is None:
            queue_ids = [q.strip() for q in os.environ.get("REVIEW_QUEUE_IDS", "").split(",") if q.strip()]
        self.gw = gateway or MlflowGateway(
            experiment_id or os.environ.get("MLFLOW_EXPERIMENT_ID", ""),
            warehouse_id or os.environ.get("DATABRICKS_WAREHOUSE_ID") or None,
        )
        self.backend = ReviewBackend(self.gw, queue_ids=queue_ids)
        self.can_write = can_write
        self.router = self._routes()

    def mount(self, app: FastAPI) -> None:
        app.include_router(self.router)
        app.mount("/_review", StaticFiles(directory=CLIENT_DIR), name="review-client")
        app.add_api_route("/setup", lambda: FileResponse(CLIENT_DIR / "setup.html"), include_in_schema=False)

        @app.exception_handler(ReviewError)
        async def _review_error(_request, e: ReviewError):
            return JSONResponse({"error": str(e)}, status_code=e.status)

        @app.exception_handler(UpstreamError)
        async def _upstream_error(_request, e: UpstreamError):
            # MLflow refused the call, for example no grant on the trace tables.
            logger.warning("MLflow error: %s", e)
            return JSONResponse({"error": f"MLflow error: {e}"}, status_code=502)

    # ---- helpers for your own routes ----
    # Each one takes the request and checks the signed-in reviewer. They raise ReviewError (with
    # `status`) when the reviewer may not do it. save_answers and set_status skip `can_write`: your
    # route decides who may call them.

    def reviewer(self, request: Request) -> str:
        """The signed-in reviewer's email."""
        return reviewer(request)

    def check_item(self, request: Request, queue_id: str, item_id: str) -> dict:
        """The item ({id, status, trace_id, completed_by}) if the reviewer is a queue member and it is in the queue."""
        return self.backend.check_item(queue_id, item_id, reviewer(request))

    def check_answers(self, request: Request, queue_id: str, answers: Any) -> None:
        """Checks answers against the queue's questions, as review.saveAnswers does."""
        self.backend.list_members(queue_id, reviewer(request))
        self.backend.check_answers(queue_id, answers)

    def list_members(self, request: Request, queue_id: str) -> list[str]:
        """The queue's members (emails)."""
        return self.backend.list_members(queue_id, reviewer(request))

    def save_answers(self, request: Request, queue_id: str, item_id: str, answers: Any) -> dict:
        return self.backend.save_answers(queue_id, item_id, reviewer(request), answers)

    def set_status(self, request: Request, queue_id: str, item_id: str, status: Any) -> dict:
        return self.backend.set_status(queue_id, item_id, reviewer(request), status)

    # ---- routes ----

    def _check_write(self, request: Request, queue_id: str) -> None:
        if self.can_write is None:
            return
        email = reviewer(request)
        self.backend.list_members(queue_id, email)  # members first, so the hook sees only real queues
        if not self.can_write(email, queue_id):
            raise ReviewError("You cannot save answers to MLflow in this app.", 403)

    def _routes(self) -> APIRouter:
        r = APIRouter(prefix="/api/review-queue")
        be = self.backend

        # Plain `def` routes: FastAPI runs them in a thread pool, since the MLflow SDK is blocking.
        @r.get("/me")
        def me(request: Request):
            return {"email": reviewer(request)}

        @r.get("/queues")
        def queues(request: Request):
            return {"queues": be.list_my_queues(reviewer(request))}

        @r.get("/queues/{queue_id}/items")
        def items(request: Request, queue_id: str, status: str | None = None):
            return {"items": be.list_my_items(queue_id, reviewer(request), status)}

        @r.get("/queues/{queue_id}/members")
        def members(request: Request, queue_id: str):
            return {"members": be.list_members(queue_id, reviewer(request))}

        @r.get("/queues/{queue_id}/items/{item_id}")
        def item(request: Request, queue_id: str, item_id: str):
            return be.get_item(queue_id, item_id, reviewer(request))

        @r.put("/queues/{queue_id}/items/{item_id}/answers")
        def answers(request: Request, queue_id: str, item_id: str, body: dict = Body(default_factory=dict)):
            self._check_write(request, queue_id)
            return self.save_answers(request, queue_id, item_id, body.get("answers"))

        @r.put("/queues/{queue_id}/items/{item_id}/status")
        def status(request: Request, queue_id: str, item_id: str, body: dict = Body(default_factory=dict)):
            self._check_write(request, queue_id)
            return self.set_status(request, queue_id, item_id, body.get("status"))

        @r.get("/setup")
        def setup(request: Request):
            return run_checks(self.gw, reviewer(request))

        # The service principal cannot grant itself tables it does not own, so the GRANTs run as the
        # signed-in user, through the `sql` user scope.
        @r.post("/setup/grant")
        def grant(request: Request):
            reviewer(request)
            token = request.headers.get("x-forwarded-access-token")
            if not token:
                raise ReviewError(NO_GRANT_SCOPE, 401)
            return run_grants(self.gw, token)

        return r
