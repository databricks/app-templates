from types import SimpleNamespace

from runtime import stores
from tests.conftest import STORE


def session_items(*items: dict) -> SimpleNamespace:
    """A session store holding `items`, oldest first, that records each pop."""
    kit = SimpleNamespace(items=list(items), pops=[])

    def list_session_items(parent: str, order_by: str):
        return [SimpleNamespace(data=item) for item in kit.items]

    def pop_session_item(parent: str) -> None:
        kit.pops.append(parent)
        kit.items.pop()

    kit.list_session_items = list_session_items
    kit.pop_session_item = pop_session_item
    return SimpleNamespace(agent_kit=kit)


def test_the_last_turn_goes_from_its_question_on(monkeypatch):
    monkeypatch.setenv("AGENT_SESSION_STORE", STORE)
    first = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "Hello"},
    ]
    last = [
        {"role": "user", "content": "My records?"},
        {"type": "function_call", "call_id": "c1"},
        {"type": "function_call_output", "call_id": "c1"},
        {"role": "assistant", "content": "You have 3."},
    ]
    client = session_items(*first, *last)

    assert stores.drop_last_turn(client, "s1") == 4

    assert client.agent_kit.items == first
    assert client.agent_kit.pops == [f"session-stores/{STORE}/sessions/s1"] * 4


def test_a_transcript_without_a_question_keeps_everything(monkeypatch):
    monkeypatch.setenv("AGENT_SESSION_STORE", STORE)
    client = session_items({"role": "assistant", "content": "Hello"})

    assert stores.drop_last_turn(client, "s1") == 0

    assert client.agent_kit.pops == []
