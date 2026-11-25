"""Review Queue access for an app that calls MLflow as its service principal. Template-owned.

The service principal can read and write the whole experiment, so this module is the only place
that decides what a reviewer may see or change. The rules:

- Who: the reviewer is the email the Apps proxy puts in `x-forwarded-email`.
- Which queues: only queues in the configured experiment where the reviewer is a member.
- Which items: only items listed in that queue. The browser sends a queue id and an item id,
  never a trace id or a trace location, so it cannot point the service principal at other data.
- Which answers: only effective questions of that queue, with values that match the question.
  Each answer is written with the reviewer as the HUMAN source, and overrides only that
  reviewer's own earlier answer.
"""

from __future__ import annotations

import math
import re
import time
from typing import Any, Callable

# No leading dot, so ".." cannot change an MLflow path.
_ID = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._:-]{0,255}")
TRACE_LOCATION_TAG = "mlflow.experiment.databricksTraceDestinationPath"
STATUSES = {"PENDING", "COMPLETE", "DECLINED"}


class ReviewError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _not_found(what: str) -> ReviewError:
    return ReviewError(f"{what} not found.", 404)


def check_id(value: Any, what: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ReviewError(f"Invalid {what}.")
    return value


def same_user(a: Any, b: str) -> bool:
    return isinstance(a, str) and a.strip().lower() == b.strip().lower()


def _public_item(item: dict) -> dict:
    """Only what the browser needs. The trace location stays on the server."""
    return {k: item.get(k) for k in ("id", "status", "trace_id", "completed_by") if item.get(k) is not None}


class ReviewBackend:
    def __init__(
        self,
        gateway,
        *,
        queue_ids: list[str] | None = None,
        members_ttl_s: float = 30,
        now: Callable[[], float] = time.monotonic,
    ):
        self.gw = gateway
        self.allowed_queues = set(queue_ids) if queue_ids else None
        self.ttl = members_ttl_s
        self.now = now
        self._members: dict[str, tuple[float, list[str]]] = {}
        self._location: str | None = None

    # ---- reads ----

    def list_my_queues(self, email: str) -> list[dict]:
        mine = []
        for q in self.gw.list_queues():
            if self.allowed_queues and q["id"] not in self.allowed_queues:
                continue
            # shortcut: trace items only; add dataset records when a customer asks.
            if q.get("queue_type") == "DATASET":
                continue
            if self._is_member(q["id"], email):
                mine.append({**q, "display_name": q.get("display_name") or q["id"]})
        return mine

    def list_my_items(self, queue_id: str, email: str, status: str | None = None) -> list[dict]:
        self._require_member(queue_id, email)
        if status is not None and status not in STATUSES:
            raise ReviewError("Invalid status.")
        return [_public_item(i) for i in self._queue_items(queue_id, status)]

    def list_members(self, queue_id: str, email: str) -> list[str]:
        self._require_member(queue_id, email)  # also fills the member cache
        return list(self._members[queue_id][1])

    def get_item(self, queue_id: str, item_id: str, email: str) -> dict:
        self._require_member(queue_id, email)
        item = self._find_item(queue_id, item_id)
        trace = self.gw.get_trace(self._trace_location(), item["trace_id"])
        if not trace:
            raise _not_found("Trace")
        mine = self._my_answers(trace["assessments"], email)
        # Other reviewers' answers stay hidden, so each review is blind; the reviewer's own come below.
        return {
            "item": _public_item(item),
            "trace": {"trace_info": trace["trace_info"], "spans": trace["spans"]},
            "questions": self.gw.questions(queue_id),
            "answers": {
                name: {"value": a["value"], **({"rationale": a["rationale"]} if a.get("rationale") else {})}
                for name, a in mine.items()
            },
        }

    # ---- checks for your own routes ----

    def check_item(self, queue_id: str, item_id: str, email: str) -> dict:
        """Raises a 404 ReviewError unless the reviewer is a queue member and the item is in that queue."""
        self._require_member(queue_id, email)
        return _public_item(self._find_item(queue_id, item_id))

    def check_answers(self, queue_id: str, answers: Any) -> dict[str, dict]:
        """Raises a 400 ReviewError unless every answer is for a question of this queue and fits its type."""
        if not isinstance(answers, dict) or not answers:
            raise ReviewError("No answers to save.")
        # Answers are keyed by question title: the managed review UI uses the title as the assessment
        # name, so both UIs see the same answers.
        questions = {q["title"]: q for q in self.gw.questions(queue_id) if q.get("title")}
        for name, answer in answers.items():
            q = questions.get(name)
            if q is None:
                raise ReviewError(f"Question {name!r} is not in this queue.")
            if not isinstance(answer, dict):
                raise ReviewError(f"Answer for {name!r} must be an object.")
            validate_value(q, answer.get("value"))
            if answer.get("rationale") is not None and not q.get("enable_comment"):
                raise ReviewError(f"Question {name!r} does not allow a comment.")
        return questions

    # ---- writes ----

    def save_answers(self, queue_id: str, item_id: str, email: str, answers: Any) -> dict:
        self._require_member(queue_id, email)
        item = self._find_item(queue_id, item_id)
        questions = self.check_answers(queue_id, answers)
        location = self._trace_location()
        trace = self.gw.get_trace(location, item["trace_id"])
        if not trace:
            raise _not_found("Trace")
        prior = self._my_answers(trace["assessments"], email)
        for name, answer in answers.items():
            self.gw.log_answer(
                location,
                item["trace_id"],
                name=name,
                kind="expectation" if questions[name].get("type") == "EXPECTATION" else "feedback",
                value=answer["value"],
                rationale=str(answer["rationale"]) if answer.get("rationale") else None,
                reviewer=email,
                overrides=prior[name]["assessment_id"] if name in prior else None,
            )
        return {"saved": list(answers)}

    def set_status(self, queue_id: str, item_id: str, email: str, status: Any) -> dict:
        self._require_member(queue_id, email)
        if status not in STATUSES:
            raise ReviewError("Invalid status.")
        self._find_item(queue_id, item_id)
        # Limit: MLflow stamps completed_by as the service principal. Each answer still names the reviewer.
        return _public_item(self.gw.set_status(queue_id, item_id, status))

    # ---- internals ----

    def _is_member(self, queue_id: str, email: str) -> bool:
        cached = self._members.get(queue_id)
        if cached is None or self.now() - cached[0] > self.ttl:
            # shortcut: members are emails today; when group members ship, expand groups here.
            cached = (self.now(), self.gw.list_members(queue_id))
            self._members[queue_id] = cached
        return any(same_user(u, email) for u in cached[1])

    def _require_member(self, queue_id: str, email: str) -> None:
        check_id(queue_id, "queue id")
        # Same answer for "no queue" and "not a member", so the app does not reveal queue ids.
        if self.allowed_queues and queue_id not in self.allowed_queues:
            raise _not_found("Queue")
        if not self._is_member(queue_id, email):
            raise _not_found("Queue")

    def _queue_items(self, queue_id: str, status: str | None = None) -> list[dict]:
        return [i for i in self.gw.list_items(queue_id, status) if i.get("kind") == "V4_TRACE" and i.get("trace_id")]

    def _find_item(self, queue_id: str, item_id: str) -> dict:
        check_id(item_id, "item id")
        # shortcut: no single-item read in the SDK, so this lists the queue; fine up to a few thousand items.
        for i in self._queue_items(queue_id):
            if i["id"] == item_id:
                return i
        raise _not_found("Item")

    def _trace_location(self) -> str:
        # Items do not carry a trace location; the managed review UI uses this experiment tag too.
        if self._location is None:
            self._location = self.gw.experiment_tags().get(TRACE_LOCATION_TAG, "")
        if not self._location:
            raise ReviewError("This experiment has no Unity Catalog trace location.")
        return self._location

    @staticmethod
    def _my_answers(assessments: list[dict], email: str) -> dict[str, dict]:
        latest: dict[str, dict] = {}
        for a in assessments:
            src = a.get("source") or {}
            if (
                a.get("valid") is False
                or src.get("source_type") != "HUMAN"
                or not same_user(src.get("source_id"), email)
            ):
                continue
            name = a["assessment_name"]
            if name not in latest or (a.get("create_time_ms") or 0) > (latest[name].get("create_time_ms") or 0):
                latest[name] = a
        return latest


def validate_value(q: dict, value: Any) -> None:
    bad = ReviewError(f"Invalid value for {q.get('title')!r}.")
    if "pass_fail" in q:
        if not isinstance(value, bool):
            raise bad
    elif "categorical" in q:
        options = set(q["categorical"].get("options") or [])
        values = value if q["categorical"].get("multi_select") else [value]
        if (
            not isinstance(values, list)
            or not values
            or any(not isinstance(v, str) or v not in options for v in values)
        ):
            raise bad
    elif "numeric" in q:
        lo, hi = q["numeric"].get("min_value"), q["numeric"].get("max_value")
        # bool is an int in Python, but not a number answer.
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise bad
        if (lo is not None and value < lo) or (hi is not None and value > hi):
            raise bad
    elif "text" in q:
        limit = q["text"].get("max_length")
        if not isinstance(value, str) or not value.strip() or (limit and len(value) > int(limit)):
            raise bad
    else:
        raise bad
