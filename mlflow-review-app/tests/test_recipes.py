"""The recipes in recipes/, against the fake gateway. Lakebase is replaced by an in-memory store."""

import importlib.util

import pytest
from conftest import ALICE, BOB, ROOT, FakeGateway, as_
from fastapi.testclient import TestClient

from review_queue import ReviewQueue

ITEM = "/api/custom/queues/rq-shared/items/i1"


def load(name: str):
    spec = importlib.util.spec_from_file_location(f"recipe_{name}", ROOT / "recipes" / name / "app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TwoMembers(FakeGateway):
    def list_members(self, queue_id):
        members = super().list_members(queue_id)
        return [*members, "carol@x.com"] if queue_id == "rq-shared" else members


# ---- custom-routes ----


@pytest.fixture
def custom(monkeypatch):
    recipe = load("custom-routes")
    monkeypatch.setattr(recipe, "READ_ONLY", {"carol@x.com"})
    fake = TwoMembers()
    return TestClient(recipe.create_app(ReviewQueue(gateway=fake, can_write=recipe.can_write))), fake


def test_check_validates_answers_without_saving(custom):
    client, fake = custom
    assert client.post(f"{ITEM}/check", headers=as_(ALICE), json={"answers": {"correct": {"value": True}}}).json() == {
        "ok": True
    }
    bad = client.post(f"{ITEM}/check", headers=as_(ALICE), json={"answers": {"correct": {"value": "yes"}}})
    assert bad.status_code == 400
    assert client.post(f"{ITEM}/check", headers=as_(BOB), json={}).status_code == 404  # not a member
    assert fake.writes() == []


def test_team_lists_the_other_members(custom):
    client, _ = custom
    assert client.get("/api/custom/queues/rq-shared/team", headers=as_(ALICE)).json() == {"others": ["carol@x.com"]}
    assert client.get("/api/custom/queues/rq-shared/team", headers=as_(BOB)).status_code == 404


def test_read_only_reviewers_cannot_save(custom):
    client, fake = custom
    url = "/api/review-queue/queues/rq-shared/items/i1/answers"
    answers = {"answers": {"correct": {"value": True}}}
    assert client.put(url, headers=as_("carol@x.com"), json=answers).status_code == 403
    assert client.put(url, headers=as_(ALICE), json=answers).status_code == 200
    assert [w[0] for w in fake.writes()] == ["log_answer"]


# ---- lakebase ----


class MemoryNotes:
    def __init__(self):
        self.rows: dict[tuple, str] = {}

    def get(self, queue_id, item_id, reviewer):
        return self.rows.get((queue_id, item_id, reviewer), "")

    def save(self, queue_id, item_id, reviewer, note):
        self.rows[(queue_id, item_id, reviewer)] = note


@pytest.fixture
def lakebase():
    notes = MemoryNotes()
    app = load("lakebase").create_app(ReviewQueue(gateway=FakeGateway()), notes)
    return TestClient(app), notes


def test_a_reviewer_saves_and_reads_their_note(lakebase):
    client, notes = lakebase
    assert client.get(f"{ITEM}/note", headers=as_(ALICE)).json() == {"note": ""}
    assert client.put(f"{ITEM}/note", headers=as_(ALICE), json={"note": "check the tool call"}).status_code == 200
    assert client.get(f"{ITEM}/note", headers=as_(ALICE)).json() == {"note": "check the tool call"}
    assert notes.rows == {("rq-shared", "i1", ALICE): "check the tool call"}


@pytest.mark.parametrize("body", [{}, {"note": 5}, {"note": "x" * 10_001}])
def test_a_bad_note_is_rejected(lakebase, body):
    client, notes = lakebase
    assert client.put(f"{ITEM}/note", headers=as_(ALICE), json=body).status_code == 400
    assert notes.rows == {}


def test_only_queue_members_reach_the_database(lakebase):
    client, notes = lakebase
    assert client.get(f"{ITEM}/note", headers=as_(BOB)).status_code == 404
    assert client.put(f"{ITEM}/note", headers=as_(BOB), json={"note": "x"}).status_code == 404
    assert client.get("/api/custom/queues/rq-shared/items/nope/note", headers=as_(ALICE)).status_code == 404
    assert notes.rows == {}
