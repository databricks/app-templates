"""recipes/adjudication: reviewers save drafts, only an adjudicator saves to MLflow.

Runs the recipe's routes against the fake gateway, with an in-memory store in place of Lakebase.
"""

import importlib.util

import pytest
from conftest import ALICE, BOB, ROOT, FakeGateway, as_
from fastapi.testclient import TestClient

from review_queue import ReviewQueue

spec = importlib.util.spec_from_file_location("adjudication_app", ROOT / "recipes/adjudication/app.py")
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)

LEAD = "lead@x.com"
URL = "/api/custom/queues/rq-shared"
ITEM = f"{URL}/items/i1"
DRAFT = {"answers": {"correct": {"value": True}}}


class MemoryDrafts:
    def __init__(self):
        self.rows: dict[tuple, dict] = {}

    def save(self, queue_id, item_id, reviewer, answers):
        self.rows[(queue_id, item_id, reviewer)] = answers

    def for_item(self, queue_id, item_id):
        return [{"reviewer": r, "answers": a} for (q, i, r), a in self.rows.items() if (q, i) == (queue_id, item_id)]

    def reviewers(self, queue_id):
        return [(i, r) for (q, i, r) in self.rows if q == queue_id]


class TwoMembers(FakeGateway):
    def list_members(self, queue_id):
        return (
            [*super().list_members(queue_id), "Lead@X.com"]
            if queue_id == "rq-shared"
            else super().list_members(queue_id)
        )


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setattr(recipe, "ADJUDICATORS", {LEAD})
    fake, drafts = TwoMembers(), MemoryDrafts()
    rq = ReviewQueue(gateway=fake, can_write=recipe.can_write)
    return TestClient(recipe.create_app(rq, drafts)), fake, drafts


def test_a_reviewer_saves_a_draft_not_an_mlflow_answer(app):
    client, fake, drafts = app
    assert client.put(f"{ITEM}/draft", headers=as_(ALICE), json=DRAFT).status_code == 200
    assert drafts.rows == {("rq-shared", "i1", ALICE): DRAFT["answers"]}
    assert client.get(f"{ITEM}/draft", headers=as_(ALICE)).json()["answers"] == DRAFT["answers"]
    assert fake.writes() == []
    # The template's own save route is closed to reviewers.
    r = client.put("/api/review-queue/queues/rq-shared/items/i1/answers", headers=as_(ALICE), json=DRAFT)
    assert r.status_code == 403


def test_drafts_use_the_template_checks(app):
    client, _, drafts = app
    assert client.put(f"{ITEM}/draft", headers=as_(BOB), json=DRAFT).status_code == 404  # not a member
    bad = {"answers": {"correct": {"value": "yes"}}}
    assert client.put(f"{ITEM}/draft", headers=as_(ALICE), json=bad).status_code == 400
    assert drafts.rows == {}


def test_progress_is_blind_and_counts_only_members(app):
    client, _, drafts = app
    drafts.save("rq-shared", "i1", "gone@x.com", {"correct": {"value": False}})  # left the queue
    client.put(f"{ITEM}/draft", headers=as_(ALICE), json=DRAFT)
    assert client.get(f"{URL}/progress", headers=as_(ALICE)).json() == {
        "progress": {"i1": {"reviews": 1, "mine": True}}
    }
    assert client.get(f"{URL}/progress", headers=as_(LEAD)).json() == {
        "progress": {"i1": {"reviews": 1, "mine": False}}
    }


def test_only_an_adjudicator_reads_drafts_and_sends_the_final_answer(app):
    client, fake, _ = app
    client.put(f"{ITEM}/draft", headers=as_(ALICE), json=DRAFT)
    assert client.get(f"{ITEM}/drafts", headers=as_(ALICE)).status_code == 403
    assert client.post(f"{ITEM}/final", headers=as_(ALICE), json=DRAFT).status_code == 403
    assert client.get(f"{ITEM}/drafts", headers=as_(LEAD)).json() == {
        "drafts": [{"reviewer": ALICE, "answers": DRAFT["answers"]}]
    }
    r = client.post(f"{ITEM}/final", headers=as_(LEAD), json=DRAFT)
    assert r.status_code == 200, r.text
    assert [(w[0], w[-1]["reviewer"] if w[0] == "log_answer" else w[-1]) for w in fake.writes()] == [
        ("log_answer", LEAD),
        ("set_status", "COMPLETE"),
    ]
    # Once adjudicated, no more drafts.
    assert client.put(f"{ITEM}/draft", headers=as_(ALICE), json=DRAFT).status_code == 409


def test_me(app):
    client, _, _ = app
    assert client.get("/api/custom/me", headers=as_(LEAD)).json() == {"adjudicator": True, "required_reviews": 2}
