"""Recipe: several reviewers answer each trace, then an adjudicator sends one final answer to MLflow.

Copy this file over the template's `app.py`, then see README.md next to it for the Lakebase resource
and the environment variables.

- Reviewers save drafts to Lakebase (table `review.drafts`). Drafts never go to MLflow.
- Adjudicators (ADJUDICATORS) see every member's draft and send the final answer.
- `can_write` stops everyone else from saving to MLflow through the template's own routes.
"""

import os
from typing import Annotated

import psycopg
from databricks.sdk import WorkspaceClient
from fastapi import Body, FastAPI, Request
from fastapi.staticfiles import StaticFiles
from psycopg.types.json import Jsonb

from review_queue import ReviewError, ReviewQueue
from security import SecurityMiddleware

ADJUDICATORS = {e.strip().lower() for e in os.environ.get("ADJUDICATORS", "").split(",") if e.strip()}
# Reviews wanted per item before the UI shows it as ready to adjudicate.
REQUIRED_REVIEWS = int(os.environ.get("REQUIRED_REVIEWS", "2"))


class LakebaseDrafts:
    """Drafts in Lakebase. The table is created on first use."""

    def __init__(self):
        self._ws = None
        self._ready = False

    def _connect(self) -> psycopg.Connection:
        # The Lakebase resource sets PGHOST, PGDATABASE and PGUSER; the password is a short-lived token.
        self._ws = self._ws or WorkspaceClient()
        token = self._ws.postgres.generate_database_credential(endpoint=os.environ["LAKEBASE_ENDPOINT"]).token
        # ponytail: one connection per request; use psycopg_pool when traffic grows.
        conn = psycopg.connect(password=token, sslmode="require")
        if not self._ready:
            # The app can't create tables in `public`; in its own schema it owns them and needs no grants.
            conn.execute("CREATE SCHEMA IF NOT EXISTS review")
            conn.execute(
                "CREATE TABLE IF NOT EXISTS review.drafts (queue_id TEXT NOT NULL, item_id TEXT NOT NULL,"
                " reviewer TEXT NOT NULL, answers JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
                " PRIMARY KEY (queue_id, item_id, reviewer))"
            )
            conn.commit()
            self._ready = True
        return conn

    def save(self, queue_id: str, item_id: str, reviewer: str, answers: dict) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO review.drafts (queue_id, item_id, reviewer, answers) VALUES (%s, %s, %s, %s)"
                " ON CONFLICT (queue_id, item_id, reviewer) DO UPDATE SET answers = EXCLUDED.answers,"
                " updated_at = now()",
                (queue_id, item_id, reviewer, Jsonb(answers)),
            )

    def for_item(self, queue_id: str, item_id: str) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT reviewer, answers, updated_at FROM review.drafts WHERE queue_id = %s AND item_id = %s"
                " ORDER BY updated_at",
                (queue_id, item_id),
            ).fetchall()
        return [{"reviewer": r, "answers": a, "updated_at": t.isoformat()} for r, a, t in rows]

    def reviewers(self, queue_id: str) -> list[tuple[str, str]]:
        """(item_id, reviewer) for every draft in the queue."""
        with self._connect() as conn:
            return conn.execute(
                "SELECT item_id, reviewer FROM review.drafts WHERE queue_id = %s", (queue_id,)
            ).fetchall()


def is_adjudicator(email: str) -> bool:
    return email.lower() in ADJUDICATORS


def can_write(email: str, queue_id: str) -> bool:
    """Only adjudicators may save to MLflow through the template's routes (`review.saveAnswers`)."""
    return is_adjudicator(email)


def create_app(review_queue: ReviewQueue | None = None, drafts=None) -> FastAPI:
    app = FastAPI(title="MLflow Review App", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(SecurityMiddleware)
    rq = review_queue or ReviewQueue(can_write=can_write)
    rq.mount(app)
    drafts = drafts or LakebaseDrafts()

    def me(request: Request) -> str:
        return rq.reviewer(request).lower()

    def require_adjudicator(request: Request) -> None:
        if not is_adjudicator(me(request)):
            raise ReviewError("Only adjudicators can do this.", 403)

    # Drafts of people who left the queue don't count.
    def members(request: Request, queue_id: str) -> set[str]:
        return {m.lower() for m in rq.list_members(request, queue_id)}

    @app.get("/api/custom/me")
    def whoami(request: Request):
        return {"adjudicator": is_adjudicator(me(request)), "required_reviews": REQUIRED_REVIEWS}

    # Per item: how many members have a draft, and whether I do. No answers, so reviews stay blind.
    @app.get("/api/custom/queues/{queue_id}/progress")
    def progress(request: Request, queue_id: str):
        current = members(request, queue_id)
        out: dict[str, dict] = {}
        for item_id, reviewer in drafts.reviewers(queue_id):
            if reviewer in current:
                p = out.setdefault(item_id, {"reviews": 0, "mine": False})
                p["reviews"] += 1
                p["mine"] = p["mine"] or reviewer == me(request)
        return {"progress": out}

    @app.get("/api/custom/queues/{queue_id}/items/{item_id}/draft")
    def my_draft(request: Request, queue_id: str, item_id: str):
        rq.check_item(request, queue_id, item_id)
        mine = [d for d in drafts.for_item(queue_id, item_id) if d["reviewer"] == me(request)]
        return mine[0] if mine else {"answers": {}}

    @app.put("/api/custom/queues/{queue_id}/items/{item_id}/draft")
    def save_draft(request: Request, queue_id: str, item_id: str, body: Annotated[dict, Body(default_factory=dict)]):
        if rq.check_item(request, queue_id, item_id)["status"] != "PENDING":
            raise ReviewError("This item is already adjudicated.", 409)
        rq.check_answers(request, queue_id, body.get("answers"))
        drafts.save(queue_id, item_id, me(request), body["answers"])
        return {"ok": True}

    @app.get("/api/custom/queues/{queue_id}/items/{item_id}/drafts")
    def all_drafts(request: Request, queue_id: str, item_id: str):
        require_adjudicator(request)
        rq.check_item(request, queue_id, item_id)
        current = members(request, queue_id)
        return {"drafts": [d for d in drafts.for_item(queue_id, item_id) if d["reviewer"] in current]}

    # The only path to MLflow: the adjudicator's answers, then the item is complete.
    @app.post("/api/custom/queues/{queue_id}/items/{item_id}/final")
    def send_final(request: Request, queue_id: str, item_id: str, body: Annotated[dict, Body(default_factory=dict)]):
        require_adjudicator(request)
        saved = rq.save_answers(request, queue_id, item_id, body.get("answers"))["saved"]
        return {"saved": saved, "item": rq.set_status(request, queue_id, item_id, "COMPLETE")}

    app.mount("/", StaticFiles(directory="static", html=True), name="static")
    return app


app = create_app()
