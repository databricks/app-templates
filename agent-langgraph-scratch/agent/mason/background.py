"""Background-run store — plumbing, slated to move into a Databricks SDK / durable backend.

``BackgroundRuns`` tracks in-flight ``background: true`` requests by response id so ``GET
/responses/{id}`` can poll them. This default is **in-memory and single-process**: runs live in a
dict in this process, so they do NOT survive a restart and are NOT shared across replicas.

For production durability (crash recovery, cross-pod resume, surviving the ~120s Apps proxy
timeout), swap this for a shared durable store (e.g. Lakebase) with the same interface — that's the
one edit needed; ``server/app.py`` only depends on ``create``/``complete``/``fail``/``get``.
"""

import uuid
from typing import Any


class BackgroundRuns:
    """In-memory store of background runs, keyed by response id. Single-process, non-durable."""

    def __init__(self) -> None:
        self._runs: dict[str, dict[str, Any]] = {}

    def create(self) -> str:
        response_id = f"resp_{uuid.uuid4().hex[:24]}"
        self._runs[response_id] = {"status": "in_progress", "output": None, "error": None}
        return response_id

    def complete(self, response_id: str, output: dict) -> None:
        self._runs[response_id] = {"status": "completed", "output": output, "error": None}

    def fail(self, response_id: str, error: str) -> None:
        self._runs[response_id] = {"status": "failed", "output": None, "error": error}

    def get(self, response_id: str) -> dict | None:
        return self._runs.get(response_id)
