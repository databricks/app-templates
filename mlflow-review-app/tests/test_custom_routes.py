"""The can_write hook and the checks the template gives to your own routes (an adjudication flow)."""

import pytest
from conftest import ALICE, API, BOB, as_
from starlette.requests import Request

from review_queue import ReviewError

SAVE = {"answers": {"correct": {"value": True}}}


def req(email: str) -> Request:
    return Request({"type": "http", "headers": [(b"x-forwarded-email", email.encode())]})


def test_can_write_false_blocks_browser_writes_but_not_reads(boot):
    asked = []
    client, fake, _ = boot(can_write=lambda email, queue_id: asked.append(f"{email} {queue_id}") or False)
    assert client.put(f"{API}/queues/rq-shared/items/i1/answers", headers=as_(ALICE), json=SAVE).status_code == 403
    status = {"status": "COMPLETE"}
    assert client.put(f"{API}/queues/rq-shared/items/i1/status", headers=as_(ALICE), json=status).status_code == 403
    assert fake.writes() == []
    assert asked == [f"{ALICE} rq-shared", f"{ALICE} rq-shared"]
    assert client.get(f"{API}/queues/rq-shared/items/i1", headers=as_(ALICE)).status_code == 200


def test_can_write_runs_only_for_queue_members(boot):
    asked = []
    client, _, _ = boot(can_write=lambda *a: asked.append(a) or True)
    assert client.put(f"{API}/queues/rq-shared/items/i1/answers", headers=as_(BOB), json=SAVE).status_code == 404
    assert asked == []
    assert client.put(f"{API}/queues/rq-shared/items/i1/answers", headers=as_(ALICE), json=SAVE).status_code == 200


def test_helpers_check_membership_items_and_answers(boot):
    _, fake, rq = boot()
    assert rq.check_item(req(ALICE), "rq-shared", "i1")["status"] == "PENDING"
    for args in [(req(BOB), "rq-shared", "i1"), (req(ALICE), "rq-shared", "nope")]:
        with pytest.raises(ReviewError) as e:
            rq.check_item(*args)
        assert e.value.status == 404
    rq.check_answers(req(ALICE), "rq-shared", {"correct": {"value": True}})
    with pytest.raises(ReviewError) as e:
        rq.check_answers(req(ALICE), "rq-shared", {"correct": {"value": "yes"}})
    assert e.value.status == 400
    with pytest.raises(ReviewError) as e:
        rq.check_answers(req(BOB), "rq-shared", {"correct": {"value": True}})
    assert e.value.status == 404
    assert rq.list_members(req(ALICE), "rq-shared") == ["Alice@X.com"]
    assert fake.writes() == []


def test_helper_save_answers_skips_can_write_for_an_adjudicator_route(boot):
    _, fake, rq = boot(can_write=lambda *a: False)
    rq.save_answers(req(ALICE), "rq-shared", "i1", {"correct": {"value": True}})
    rq.set_status(req(ALICE), "rq-shared", "i1", "COMPLETE")
    log, status = fake.writes()
    assert log[3]["reviewer"] == ALICE and log[3]["overrides"] == "a-old"
    assert status == ("set_status", "rq-shared", "i1", "COMPLETE")
