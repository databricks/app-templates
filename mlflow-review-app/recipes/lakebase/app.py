"""Recipe: keep your own data in Lakebase, next to the MLflow answers.

Copy this file over the template's `app.py`. See README.md next to it for the Lakebase resource.

Each reviewer keeps a private note per item (`GET` and `PUT /api/custom/queues/{queue_id}/items/{item_id}/note`).
The note is in Lakebase; MLflow holds only the answers.
"""

import os
from typing import Annotated

import psycopg
from databricks.sdk import WorkspaceClient
from fastapi import Body, FastAPI, Request
from fastapi.staticfiles import StaticFiles

from review_queue import ReviewError, ReviewQueue
from security import SecurityMiddleware

MAX_NOTE_CHARS = 10_000


class LakebaseNotes:
    """Notes in Lakebase. The table is created on first use."""

    def __init__(self):
        self._ws: WorkspaceClient | None = None
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
                "CREATE TABLE IF NOT EXISTS review.notes (queue_id TEXT NOT NULL, item_id TEXT NOT NULL,"
                " reviewer TEXT NOT NULL, note TEXT NOT NULL, PRIMARY KEY (queue_id, item_id, reviewer))"
            )
            conn.commit()
            self._ready = True
        return conn

    def get(self, queue_id: str, item_id: str, reviewer: str) -> str:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT note FROM review.notes WHERE queue_id = %s AND item_id = %s AND reviewer = %s",
                (queue_id, item_id, reviewer),
            ).fetchone()
        return row[0] if row else ""

    def save(self, queue_id: str, item_id: str, reviewer: str, note: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO review.notes VALUES (%s, %s, %s, %s)"
                " ON CONFLICT (queue_id, item_id, reviewer) DO UPDATE SET note = EXCLUDED.note",
                (queue_id, item_id, reviewer, note),
            )


def create_app(review_queue: ReviewQueue | None = None, notes=None) -> FastAPI:
    app = FastAPI(title="MLflow Review App", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(SecurityMiddleware)
    rq = review_queue or ReviewQueue()
    rq.mount(app)
    notes = notes or LakebaseNotes()

    @app.get("/api/custom/queues/{queue_id}/items/{item_id}/note")
    def get_note(request: Request, queue_id: str, item_id: str):
        rq.check_item(request, queue_id, item_id)  # 404 unless a queue member and the item is in the queue
        return {"note": notes.get(queue_id, item_id, rq.reviewer(request).lower())}

    @app.put("/api/custom/queues/{queue_id}/items/{item_id}/note")
    def save_note(request: Request, queue_id: str, item_id: str, body: Annotated[dict, Body(default_factory=dict)]):
        rq.check_item(request, queue_id, item_id)
        note = body.get("note")
        if not isinstance(note, str) or len(note) > MAX_NOTE_CHARS:
            raise ReviewError(f"A note must be text of at most {MAX_NOTE_CHARS} characters.")
        notes.save(queue_id, item_id, rq.reviewer(request).lower(), note)
        return {"ok": True}

    app.mount("/", StaticFiles(directory="static", html=True), name="static")
    return app


app = create_app()
