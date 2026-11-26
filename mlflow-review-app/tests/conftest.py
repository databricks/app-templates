"""A fake MLflow + Unity Catalog gateway for tests. It answers the calls the template makes and
records them, so tests can check what was written and as whom."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)  # the app serves static/ from the working directory, as in production

from app import create_app  # noqa: E402
from review_queue import ReviewQueue, UpstreamError  # noqa: E402

API = "/api/review-queue"
ALICE = "alice@x.com"
BOB = "bob@x.com"
SP = "sp-app-id"
TABLE_PREFIX = "cat.sch.tr"
ANN = f"{TABLE_PREFIX}_otel_annotations"
ALL_GOOD = {
    "cat": ["USE_CATALOG"],
    "cat.sch": ["USE_SCHEMA"],
    f"{TABLE_PREFIX}_otel_spans": ["SELECT"],
    f"{TABLE_PREFIX}_otel_logs": ["ALL_PRIVILEGES"],
    ANN: ["SELECT", "MODIFY"],
}
QUESTIONS = [
    {"title": "correct", "type": "FEEDBACK", "pass_fail": {}},
    {"title": "tone", "type": "FEEDBACK", "categorical": {"options": ["ok", "rude"]}, "enable_comment": True},
    {"title": "score", "type": "EXPECTATION", "numeric": {"min_value": 1, "max_value": 5}},
]


def as_(email: str, **headers: str) -> dict:
    return {"x-forwarded-email": email, **headers}


def with_token(email: str = ALICE) -> dict:
    """A signed-in user with a forwarded token: the Apps proxy sends both when the app has a user scope."""
    return as_(email, **{"x-forwarded-access-token": f"tok-{email}"})


class FakeGateway:
    warehouse_id = "wh"

    def __init__(
        self,
        privileges=None,
        user_privileges=None,
        owners=None,
        table_prefix: str | None = TABLE_PREFIX,
        perms_error=False,
        deny_statements=(),
    ):
        self.privs = privileges
        self.user_privs = user_privileges or {}
        self.owners = owners or {}
        self.table_prefix = table_prefix
        self.perms_error = perms_error
        self.deny = deny_statements
        self.calls: list[tuple] = []
        self.statements: list[tuple[str, str]] = []  # (user token, statement)
        self.status = "PENDING"
        self.assessments = [
            # Alice's earlier answer (and a newer one she since overrode), Bob's answer, and an LLM
            # judge answer on the same trace.
            _a("a-old", ALICE, False, 1),
            {**_a("a-stale", ALICE, True, 5), "valid": False},
            _a("b-1", BOB, True, 2),
            {**_a("j-1", "judge", True, 3), "source": {"source_type": "LLM_JUDGE", "source_id": "judge"}},
        ]

    def writes(self):
        return [c for c in self.calls if c[0] in ("log_answer", "set_status")]

    def _item(self):
        return {"id": "i1", "status": self.status, "kind": "V4_TRACE", "trace_id": "t1"}

    def list_queues(self):
        self.calls.append(("list_queues",))
        return [
            {"id": "rq-shared", "display_name": "Shared", "queue_type": "CUSTOM"},
            {"id": "rq-bob", "display_name": BOB, "queue_type": "USER"},
        ]

    def list_members(self, queue_id):
        self.calls.append(("list_members", queue_id))
        members = {"rq-shared": ["Alice@X.com"], "rq-bob": [BOB]}
        if queue_id not in members:
            raise UpstreamError(f"NOT_FOUND: queue {queue_id}")
        return members[queue_id]

    def list_items(self, queue_id, status=None):
        items = [self._item()] if queue_id == "rq-shared" else []
        return [i for i in items if status in (None, i["status"])]

    def questions(self, queue_id):
        return [dict(q) for q in QUESTIONS] if queue_id == "rq-shared" else []

    def experiment_tags(self):
        tags = {"mlflow.experiment.databricksTraceDestinationPath": TABLE_PREFIX}
        if self.table_prefix:
            for k, v in {"Span": "spans", "Log": "logs", "Annotation": "annotations"}.items():
                tags[f"mlflow.experiment.databricksTrace{k}StorageTable"] = f"{self.table_prefix}_otel_{v}"
        return tags

    def get_trace(self, location, trace_id):
        if (location, trace_id) != (TABLE_PREFIX, "t1"):
            return None
        return {
            "trace_info": {
                "trace_id": "t1",
                "request_preview": '{"question": "What is MLflow?"}',
                "response_preview": '{"answer": "An open source platform for the ML lifecycle."}',
            },
            "spans": [],
            "assessments": list(self.assessments),
        }

    def log_answer(self, location, trace_id, **a):
        self.calls.append(("log_answer", location, trace_id, a))
        new = _a(f"new-{len(self.assessments)}", a["reviewer"], a["value"], 100 + len(self.assessments))
        self.assessments.append({**new, "assessment_name": a["name"]})

    def set_status(self, queue_id, item_id, status):
        self.calls.append(("set_status", queue_id, item_id, status))
        self.status = status
        return {**self._item(), "completed_by": SP}

    def service_principal(self):
        return SP

    def first_queue(self):
        return "rq-shared"

    def check_members(self, queue_id):
        pass

    def check_warehouse(self):
        pass

    def privileges(self, kind, name, principal):
        if self.perms_error:
            raise UpstreamError("403 no access")
        source = (self.privs or {}) if principal == SP else self.user_privs
        return set(source.get(name, []))

    def owner(self, kind, name):
        if self.owners == "error":
            raise UpstreamError("no access")
        return self.owners.get(name, "someone@else.com")

    def run_sql_as_user(self, user_token, statement):
        self.statements.append((user_token, statement))
        if any(d in statement for d in self.deny):
            return False, "PERMISSION_DENIED: User does not have MANAGE"
        # A GRANT that runs gives the service principal the privileges, so /setup turns ready.
        m = re.match(r"GRANT (.+) ON \w+ (\S+) TO ", statement)
        if m and self.privs is not None:
            name = m.group(2).replace("`", "")
            self.privs[name] = self.privs.get(name, []) + [p.replace(" ", "_") for p in m.group(1).split(", ")]
        return True, None


def _a(aid, source_id, value, t):
    return {
        "assessment_id": aid,
        "assessment_name": "correct",
        "valid": True,
        "source": {"source_type": "HUMAN", "source_id": source_id},
        "value": value,
        "rationale": None,
        "create_time_ms": t,
    }


@pytest.fixture
def boot():
    """Boots the real app (routes + static UI + security middleware) against a fake gateway."""

    def _boot(fake: FakeGateway | None = None, **config):
        fake = fake or FakeGateway()
        config.setdefault("trace_destination", TABLE_PREFIX)
        rq = ReviewQueue(gateway=fake, **config)
        client = TestClient(create_app(rq))
        return client, fake, rq

    return _boot
