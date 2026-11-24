"""The display tools: show only values the run's reads hold, and change nothing."""

import json
import logging
from types import SimpleNamespace

from agents.tool_context import ToolContext

from agent import agent as agent_module
from agent.agent import run_agent
from agent.tools import display
from tests.conftest import DEFAULT_MODEL, STEP, agent_request, answers, asks_for

READ = '[{"name": "Archive", "amount": "8500.00", "booked_at": "2026-10-12T09:30:00"}]'
COLUMNS = [
    {"key": "name", "label": "Record"},
    {
        "key": "amount",
        "label": "Amount",
        "format": {"kind": "currency", "currency": "EUR"},
    },
]
OPTIONS = [
    {"id": "a", "label": "First", "description": ""},
    {"id": "b", "label": "Second", "description": "The one for 8,500.00"},
]
QUESTION = {
    "id": "which",
    "question": "Which one?",
    "options": OPTIONS,
    "multiple": False,
}
PLAN = [
    {"id": "read", "text": "Read your records", "status": "done"},
    {"id": "sum", "text": "Compare them", "status": "active"},
]


async def invoke(tool, request, arguments: dict) -> str:
    text = json.dumps({"step": STEP} | arguments)
    return await tool.on_invoke_tool(
        ToolContext(
            context=request,
            tool_name=tool.name,
            tool_call_id="call-9",
            tool_arguments=text,
        ),
        text,
    )


async def test_a_table_of_values_the_run_read_is_shown(request_context, recorder):
    request_context.reads.append(READ)

    output = await invoke(
        display.show_table,
        request_context,
        {"title": "Your records", "columns": COLUMNS, "rows": [["Archive", 8500]]},
    )

    assert output == display.SHOWN
    assert recorder.events == [
        {
            "type": "display",
            "call_id": "call-9",
            "view": "table",
            "payload": {
                "title": "Your records",
                "columns": COLUMNS,
                "rows": [{"name": "Archive", "amount": 8500}],
            },
        }
    ]


async def test_one_figure_is_shown_and_given_in_the_answer(request_context, recorder):
    request_context.reads.append(READ)

    output = await invoke(
        display.show_number, request_context, {"label": "Amount", "value": 8500}
    )

    assert output == display.SHOWN
    assert recorder.events[0]["payload"] == {"label": "Amount", "value": 8500}


async def test_a_figure_the_reads_dont_hold_is_refused(
    request_context, recorder, caplog
):
    request_context.reads.append(READ)

    with caplog.at_level(logging.WARNING):
        output = await invoke(
            display.show_details,
            request_context,
            {
                "title": "Total",
                "rows": [
                    {"label": "Sum", "value": "€9,000.00"},
                    {"label": "Rest", "value": "500"},
                ],
            },
        )

    assert output == display.NOT_GROUNDED.format(count=2)
    assert recorder.events == []
    [record] = caplog.records
    assert (record.message, record.status, record.values) == (
        "Display refused",
        "NOT_GROUNDED",
        2,
    )
    assert "9,000" not in caplog.text


async def test_formatted_figures_match_the_values_they_show(request_context, recorder):
    request_context.reads.append(READ)

    output = await invoke(
        display.show_details,
        request_context,
        {"title": "Archive", "rows": [{"label": "Amount", "value": "€8,500.00"}]},
    )

    assert output == display.SHOWN
    assert recorder.events[0]["view"] == "details"


async def test_a_question_asks_for_the_users_next_message(request_context, recorder):
    request_context.reads.append(READ)

    output = await invoke(display.ask_user, request_context, {"questions": [QUESTION]})

    assert output == display.ASKED
    assert recorder.events == [
        {
            "type": "display",
            "call_id": "call-9",
            "view": "questions",
            "payload": {"questions": [QUESTION]},
        }
    ]


async def test_an_answer_with_a_figure_the_reads_dont_hold_is_refused(
    request_context, recorder
):
    output = await invoke(display.ask_user, request_context, {"questions": [QUESTION]})

    assert output == display.NOT_GROUNDED.format(count=1)
    assert recorder.events == []


async def test_a_question_with_one_answer_shows_nothing(request_context, recorder):
    question = QUESTION | {"options": OPTIONS[:1]}

    output = await invoke(display.ask_user, request_context, {"questions": [question]})

    assert output not in (display.SHOWN, display.ASKED)
    assert recorder.events == []


async def test_a_comparison_goes_out_in_the_names_the_app_reads(
    request_context, recorder
):
    request_context.reads.append('[{"rate": "2.10"}, {"rate": "3.05"}]')
    options = [
        {"id": "a", "name": "First", "headline": "Flexible", "traits": ["2.10%", ""]},
        {"id": "b", "name": "Second", "headline": "Fixed", "traits": ["3.05%", "Yes"]},
    ]

    await invoke(
        display.show_comparison,
        request_context,
        {
            "trait_labels": ["Rate", "Fixed term"],
            "options": options,
            "recommended_id": "",
            "reason": "The second pays more and locks the money in.",
        },
    )

    assert recorder.events[0]["payload"] == {
        "traitLabels": ["Rate", "Fixed term"],
        "options": options,
        "recommendedId": "",
        "reason": "The second pays more and locks the money in.",
    }


async def test_a_plan_is_shown_without_reads(request_context, recorder):
    output = await invoke(
        display.update_plan, request_context, {"title": "Your records", "items": PLAN}
    )

    assert output == display.SHOWN
    assert recorder.events[0]["payload"] == {"title": "Your records", "items": PLAN}


async def test_a_plan_with_an_unknown_status_shows_nothing(request_context, recorder):
    items = [PLAN[0] | {"status": "skipped"}]

    await invoke(display.update_plan, request_context, {"title": "X", "items": items})

    assert recorder.events == []


async def test_a_report_keeps_only_the_sources_the_run_read(request_context, recorder):
    request_context.activity.extend(
        [
            {
                "tool": "read_records",
                "outcome": "allowed",
                "target": "cat.data.records",
            },
            {"tool": "read_records", "outcome": "denied", "target": "cat.data.secrets"},
            {"tool": "model", "outcome": "allowed", "target": "sonnet_llm"},
            {
                "tool": "rename_record",
                "outcome": "allowed",
                "target": "cat.ops.rename_record",
                "proposal_id": "p-1",
            },
        ]
    )
    section = {
        "id": "a",
        "heading": "Records",
        "summary": "One record.",
        "sources": ["records", "secrets", "sonnet_llm", "rename_record"],
    }

    await invoke(
        display.show_report, request_context, {"title": "Report", "sections": [section]}
    )

    assert recorder.events[0]["payload"] == {
        "title": "Report",
        "sections": [section | {"sources": ["records"]}],
        "sourcesRead": 1,
    }


async def test_a_run_shows_a_table_after_reading_its_rows(
    monkeypatch, streaming_model, records
):
    records.rows = [{"name": "Archive", "amount": "25.00"}]
    tools = [*agent_module.all_tools(), display.show_table]
    monkeypatch.setattr(agent_module, "all_tools", lambda: tools)
    table = {
        "step": STEP,
        "title": "Your records",
        "columns": COLUMNS,
        "rows": [["Archive", "25.00"]],
    }
    streaming_model.replies = [
        asks_for("read_records", {"step": STEP}),
        asks_for("show_table", table).replace("call_1", "call_2"),
        answers("Here they are."),
    ]
    recorder = SimpleNamespace(events=[])
    request = agent_request("run-1", recorder)

    async with run_agent(
        [{"role": "user", "content": "Records?"}],
        request=request,
        model=DEFAULT_MODEL,
        effort="low",
    ) as result:
        async for _ in result.stream_events():
            pass

    shown = [event for event in recorder.events if event["type"] == "display"]
    assert [(event["call_id"], event["payload"]["rows"]) for event in shown] == [
        ("call_2", [{"name": "Archive", "amount": "25.00"}])
    ]
    assert request.reads == ["Records?", json.dumps(records.rows)]


async def test_row_numbers_up_to_a_hundred_need_no_read(request_context, recorder):
    request_context.reads.append(READ)
    columns = [{"key": "year", "label": "Year"}, COLUMNS[1]]

    output = await invoke(
        display.show_table,
        request_context,
        {
            "title": "By year",
            "columns": columns,
            "rows": [[3, 8500], ["Year 100", 8500]],
        },
    )
    refused = await invoke(
        display.show_table,
        request_context,
        {"title": "By year", "columns": columns, "rows": [[101, 8500]]},
    )

    assert output == display.SHOWN
    assert refused == display.NOT_GROUNDED.format(count=1)
