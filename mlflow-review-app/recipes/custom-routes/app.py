"""Recipe: your own backend routes, with the template's access checks.

Copy this file over the template's `app.py`. See README.md next to it.

- `POST /api/custom/queues/{queue_id}/items/{item_id}/check`: checks answers against the queue's
  questions without saving them, so the UI can show errors before the reviewer submits.
- `GET /api/custom/queues/{queue_id}/team`: the queue's other members, for a "who else reviews this"
  panel.
- READ_ONLY_REVIEWERS (comma-separated emails) can read but not save, through `can_write`.
"""

import os
from typing import Annotated

from fastapi import Body, FastAPI, Request
from fastapi.staticfiles import StaticFiles

from review_queue import ReviewQueue
from security import SecurityMiddleware

READ_ONLY = {e.strip().lower() for e in os.environ.get("READ_ONLY_REVIEWERS", "").split(",") if e.strip()}


def can_write(email: str, queue_id: str) -> bool:
    """Who may save answers and set status through the template's routes (`review.saveAnswers`)."""
    return email.lower() not in READ_ONLY


def create_app(review_queue: ReviewQueue | None = None) -> FastAPI:
    app = FastAPI(title="MLflow Review App", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(SecurityMiddleware)
    rq = review_queue or ReviewQueue(can_write=can_write)
    rq.mount(app)

    # Your routes run as the app's service principal. The helpers check the signed-in reviewer: each
    # raises ReviewError (404 if not a queue member or not in the queue, 400 for bad answers), which
    # the app returns as {"error": ...}.

    @app.post("/api/custom/queues/{queue_id}/items/{item_id}/check")
    def check(request: Request, queue_id: str, item_id: str, body: Annotated[dict, Body(default_factory=dict)]):
        rq.check_item(request, queue_id, item_id)
        rq.check_answers(request, queue_id, body.get("answers"))
        return {"ok": True}

    @app.get("/api/custom/queues/{queue_id}/team")
    def team(request: Request, queue_id: str):
        me = rq.reviewer(request).lower()
        return {"others": [m for m in rq.list_members(request, queue_id) if m.lower() != me]}

    app.mount("/", StaticFiles(directory="static", html=True), name="static")
    return app


app = create_app()
