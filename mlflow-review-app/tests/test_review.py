"""Permission and answer rules of the template, against a fake gateway."""

import pytest
from conftest import ALICE, API, BOB, SP, FakeGateway, as_

from review_queue import UpstreamError
from review_queue.backend import ReviewBackend

ALICE_H = as_(ALICE)


def test_no_signed_in_user_is_rejected(boot):
    client, _, _ = boot()
    assert client.get(f"{API}/queues").status_code == 401


def test_a_reviewer_sees_only_their_own_queues_matched_case_insensitively(boot):
    client, _, _ = boot()
    assert [q["id"] for q in client.get(f"{API}/queues", headers=ALICE_H).json()["queues"]] == ["rq-shared"]
    assert [q["id"] for q in client.get(f"{API}/queues", headers=as_(BOB)).json()["queues"]] == ["rq-bob"]


def test_a_non_member_cannot_read_or_write(boot):
    client, fake, _ = boot()
    bob = as_(BOB)
    assert client.get(f"{API}/queues/rq-shared/items", headers=bob).status_code == 404
    assert client.get(f"{API}/queues/rq-shared/items/i1", headers=bob).status_code == 404
    answers = {"answers": {"correct": {"value": True}}}
    assert client.put(f"{API}/queues/rq-shared/items/i1/answers", headers=bob, json=answers).status_code == 404
    status = {"status": "COMPLETE"}
    assert client.put(f"{API}/queues/rq-shared/items/i1/status", headers=bob, json=status).status_code == 404
    assert fake.writes() == []


def test_members_are_listed_only_to_members(boot):
    client, _, _ = boot()
    assert client.get(f"{API}/queues/rq-shared/members", headers=ALICE_H).json() == {"members": ["Alice@X.com"]}
    assert client.get(f"{API}/queues/rq-shared/members", headers=as_(BOB)).status_code == 404


def test_an_item_hides_the_trace_location_and_other_reviewers_answers(boot):
    client, _, _ = boot()
    body = client.get(f"{API}/queues/rq-shared/items/i1", headers=ALICE_H).json()
    assert body["item"] == {"id": "i1", "status": "PENDING", "trace_id": "t1"}
    assert "assessments" not in body["trace"]["trace_info"]
    assert body["answers"] == {"correct": {"value": False}}
    assert [q["title"] for q in body["questions"]] == ["correct", "tone", "score"]


def test_unknown_items_and_bad_ids(boot):
    client, _, _ = boot()
    assert client.get(f"{API}/queues/rq-shared/items/nope", headers=ALICE_H).status_code == 404
    assert client.get(f"{API}/queues/rq-shared/items/..%2F..%2Fx", headers=ALICE_H).status_code in (400, 404)


@pytest.mark.parametrize("queue_id", ["..", ".x", "a%20b"])
def test_queue_id_cannot_change_the_mlflow_path(boot, queue_id):
    client, fake, _ = boot()
    assert client.get(f"{API}/queues/{queue_id}/items", headers=ALICE_H).status_code in (400, 404)
    assert not any(".." in str(c) or " " in str(c[1:]) for c in fake.calls if c[0] == "list_members")


def test_a_save_writes_as_the_reviewer_and_overrides_only_their_own_answer(boot):
    client, fake, _ = boot()
    answers = {"correct": {"value": True}, "tone": {"value": "ok", "rationale": "fine"}, "score": {"value": 4}}
    r = client.put(f"{API}/queues/rq-shared/items/i1/answers", headers=ALICE_H, json={"answers": answers})
    assert r.status_code == 200, r.text
    assert r.json() == {"saved": ["correct", "tone", "score"]}
    writes = {c[3]["name"]: c for c in fake.writes()}
    assert writes["correct"][1:3] == ("cat.sch.tr", "t1")
    assert writes["correct"][3] == {
        "name": "correct",
        "kind": "feedback",
        "value": True,
        "rationale": None,
        "reviewer": ALICE,
        "overrides": "a-old",
    }
    assert writes["tone"][3]["overrides"] is None
    assert writes["tone"][3]["rationale"] == "fine"
    assert writes["score"][3]["kind"] == "expectation"


@pytest.mark.parametrize(
    "answers",
    [
        {"other": {"value": True}},  # not a queue question
        {"correct": {"value": "yes"}},  # pass/fail needs a boolean
        {"tone": {"value": "angry"}},  # not an option
        {"tone": {"value": {"x": 1}}},  # not an option, and not hashable
        {"score": {"value": 9}},  # out of range
        {"score": {"value": True}},  # a boolean is not a number
        {"correct": {"value": True, "rationale": "x"}},  # comments are off for this question
        {"correct": "yes"},  # an answer is an object
        {},  # no answers
    ],
)
def test_invalid_answers_are_rejected_before_any_write(boot, answers):
    client, fake, _ = boot()
    r = client.put(f"{API}/queues/rq-shared/items/i1/answers", headers=ALICE_H, json={"answers": answers})
    assert r.status_code == 400
    assert fake.writes() == []


def test_status(boot):
    client, fake, _ = boot()
    url = f"{API}/queues/rq-shared/items/i1/status"
    assert client.put(url, headers=ALICE_H, json={"status": "DONE"}).status_code == 400
    r = client.put(url, headers=ALICE_H, json={"status": "COMPLETE"})
    assert r.status_code == 200
    assert r.json() == {"id": "i1", "status": "COMPLETE", "trace_id": "t1", "completed_by": SP}
    assert fake.writes() == [("set_status", "rq-shared", "i1", "COMPLETE")]


def test_the_queue_allowlist_hides_other_queues(boot):
    client, _, _ = boot(queue_ids=["rq-other"])
    assert client.get(f"{API}/queues", headers=ALICE_H).json()["queues"] == []
    assert client.get(f"{API}/queues/rq-shared/items", headers=ALICE_H).status_code == 404


def test_a_cross_origin_write_is_rejected(boot):
    client, fake, _ = boot()
    r = client.put(
        f"{API}/queues/rq-shared/items/i1/status",
        headers=as_(ALICE, origin="https://evil.example"),
        json={"status": "COMPLETE"},
    )
    assert r.status_code == 403
    assert fake.writes() == []


def test_an_mlflow_refusal_is_a_502_that_names_mlflow(boot):
    fake = FakeGateway()

    def refuse():
        raise UpstreamError("PERMISSION_DENIED: no MODIFY on table")

    fake.list_queues = refuse
    client, _, _ = boot(fake)
    r = client.get(f"{API}/queues", headers=ALICE_H)
    assert r.status_code == 502
    assert r.json()["error"].startswith("MLflow error: PERMISSION_DENIED")


def test_membership_is_cached_then_refreshed():
    fake = FakeGateway()
    clock = [0.0]
    be = ReviewBackend(fake, members_ttl_s=30, now=lambda: clock[0])
    member_calls = lambda: sum(1 for c in fake.calls if c[0] == "list_members")  # noqa: E731
    be.list_my_items("rq-shared", ALICE)
    be.list_my_items("rq-shared", ALICE)
    assert member_calls() == 1
    clock[0] = 31
    be.list_my_items("rq-shared", ALICE)
    assert member_calls() == 2


def test_no_trace_location_is_a_clear_error():
    fake = FakeGateway()
    fake.experiment_tags = lambda: {}
    with pytest.raises(Exception, match="no Unity Catalog trace location"):
        ReviewBackend(fake).get_item("rq-shared", "i1", ALICE)


@pytest.mark.parametrize(
    "rationale",
    [{"x": 1}, ["x"], 5, "x" * 10_001],  # not text, or too long
)
def test_a_comment_must_be_short_text(boot, rationale):
    client, fake, _ = boot()
    answers = {"tone": {"value": "ok", "rationale": rationale}}
    r = client.put(f"{API}/queues/rq-shared/items/i1/answers", headers=ALICE_H, json={"answers": answers})
    assert r.status_code == 400
    assert fake.writes() == []


def test_text_answers_are_capped_even_without_max_length():
    from review_queue.backend import ReviewError, validate_value

    q = {"title": "notes", "text": {}}
    validate_value(q, "x" * 10_000)
    with pytest.raises(ReviewError):
        validate_value(q, "x" * 10_001)
    with pytest.raises(ReviewError):
        validate_value({"title": "notes", "text": {"max_length": 5}}, "x" * 6)


@pytest.mark.parametrize("status", [[], {}, None, 1])
def test_a_malformed_status_is_a_400(boot, status):
    client, fake, _ = boot()
    r = client.put(f"{API}/queues/rq-shared/items/i1/status", headers=ALICE_H, json={"status": status})
    assert r.status_code == 400
    assert fake.writes() == []


def test_a_body_over_the_limit_is_a_413(boot):
    client, fake, _ = boot()
    big = {"answers": {"tone": {"value": "ok", "rationale": "x" * (1024 * 1024)}}}
    r = client.put(f"{API}/queues/rq-shared/items/i1/answers", headers=ALICE_H, json=big)
    assert r.status_code == 413
    # Chunked, so no Content-Length to trust.
    chunks = iter([b'{"answers": {"tone": {"value": "ok", "rationale": "', b"x" * (1024 * 1024), b'"}}}'])
    r = client.put(f"{API}/queues/rq-shared/items/i1/answers", headers=ALICE_H, content=chunks)
    assert r.status_code == 413
    assert fake.writes() == []


def test_scripts_load_only_from_the_app(boot):
    client, _, _ = boot()
    csp = client.get("/").headers["content-security-policy"]
    assert "script-src 'self';" in csp
