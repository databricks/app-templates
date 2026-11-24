import pytest

from agent import cancellation
from agent.agent import run_agent
from agent.cancellation import stop_run, was_stopped
from tests.conftest import DEFAULT_MODEL, STEP, agent_request, answers, asks_for

READ = {"step": STEP}


@pytest.fixture(autouse=True)
def no_rows(records) -> None:
    records.rows = []


async def test_a_stopped_run_ends_after_its_turn_and_the_next_one_runs(
    streaming_model,
):
    streaming_model.replies = [asks_for("read_records", READ)]
    first = agent_request("run-1")
    async with run_agent(
        [{"role": "user", "content": "Records?"}],
        request=first,
        model=DEFAULT_MODEL,
        effort="low",
    ) as result:
        async for event in result.stream_events():
            if event.type == "run_item_stream_event" and event.name == "tool_output":
                assert stop_run("session-a", "run-1") is True
        assert was_stopped(first)

    assert streaming_model.count == 1
    assert cancellation.RUNNING == {}
    assert not was_stopped(first)

    streaming_model.replies = [answers("You have 10 records.")]
    async with run_agent(
        [{"role": "user", "content": "And now?"}],
        request=agent_request("run-2"),
        model=DEFAULT_MODEL,
        effort="low",
    ) as result:
        async for _ in result.stream_events():
            pass
        assert result.final_output == "You have 10 records."
    assert streaming_model.count == 2
