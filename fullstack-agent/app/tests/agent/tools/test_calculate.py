"""The calculate tool: exact results from held numbers, and nothing else runs."""

import json
import logging
from types import SimpleNamespace

import pytest
from agents.tool_context import ToolContext

from agent import agent as agent_module
from agent.agent import run_agent
from agent.tools import calculate, display
from tests.conftest import DEFAULT_MODEL, STEP, agent_request, answers, asks_for

QUESTION = "6 years at 5% starting with 10k and 500 a month"
MONTHLY = "(1+5/100/12)"
SIX_YEARS = f"10*1000*{MONTHLY}**(12*6) + 500*({MONTHLY}**72-1)/(5/100/12)"


async def work_out(request, expressions: list[str]) -> list[str]:
    text = json.dumps({"step": STEP, "expressions": expressions})
    output = await calculate.calculate.on_invoke_tool(
        ToolContext(
            context=request,
            tool_name="calculate",
            tool_call_id="call-9",
            tool_arguments=text,
        ),
        text,
    )
    return json.loads(output)


async def test_figures_from_the_user_are_worked_out_to_the_cent(request_context):
    request_context.reads.append(QUESTION)

    assert await work_out(request_context, [SIX_YEARS, "10*1000 + 4*12*500"]) == [
        "55372.31",
        "34000.00",
    ]


async def test_a_number_nobody_gave_is_refused_without_echoing_it(
    request_context, caplog
):
    request_context.reads.append(QUESTION)

    with caplog.at_level(logging.WARNING):
        results = await work_out(request_context, ["54645.83 + 0", "500*12"])

    assert results == [calculate.NOT_HELD, "6000.00"]
    assert "54645" not in json.dumps(results)
    assert [(record.status, record.values) for record in caplog.records] == [
        ("NOT_CALCULATED", 1)
    ]


@pytest.mark.parametrize(
    "expression",
    [
        "__import__('os').getcwd()",
        "(500).real",
        "abs(500)",
        "500 if 1 else 12",
        "[500]",
        "500 < 12",
        "500 // 12",
        "12 ** (5/100)",
        "12 ** (12*100+1)",
        "500 +",
    ],
)
async def test_anything_but_arithmetic_is_refused(request_context, expression):
    request_context.reads.append(QUESTION)

    assert await work_out(request_context, [expression]) == [calculate.NOT_ARITHMETIC]


@pytest.mark.parametrize(
    "expression", ["500 / (12 - 12)", "1000 ** 12", "500 ** (12*12)"]
)
async def test_a_result_that_isnt_a_finite_figure_is_refused(
    request_context, expression
):
    request_context.reads.append(QUESTION)

    assert await work_out(request_context, [expression]) == [calculate.NOT_FINITE]


async def test_a_run_shows_a_figure_it_worked_out_from_the_question(
    monkeypatch, streaming_model, records
):
    tools = [*agent_module.all_tools(), calculate.calculate, display.show_number]
    monkeypatch.setattr(agent_module, "all_tools", lambda: tools)
    streaming_model.replies = [
        asks_for("calculate", {"step": STEP, "expressions": [SIX_YEARS]}),
        asks_for(
            "show_number", {"step": STEP, "label": "After 6 years", "value": 55372.31}
        ).replace("call_1", "call_2"),
        answers("About €55,372.31."),
    ]
    recorder = SimpleNamespace(events=[])

    async with run_agent(
        [{"role": "user", "content": QUESTION}],
        request=agent_request("run-1", recorder),
        model=DEFAULT_MODEL,
        effort="low",
    ) as result:
        async for _ in result.stream_events():
            pass

    shown = [event for event in recorder.events if event["type"] == "display"]
    assert [(event["call_id"], event["payload"]["value"]) for event in shown] == [
        ("call_2", 55372.31)
    ]
