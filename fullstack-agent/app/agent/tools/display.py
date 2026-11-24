"""Display tools render read-only elements. Values are checked against held reads."""

import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal

from agents import Agent, AgentHooks, RunContextWrapper, Tool, function_tool
from agents.tool_context import ToolContext
from pydantic import BaseModel, Field

from agent.context import RequestContext
from agent.tools import Step

logger = logging.getLogger(__name__)

SHOWN = "Shown to the user."
ASKED = "Shown to the user. Their answer comes as their next message."
NOT_GROUNDED = (
    "Not shown: {count} values aren't in the data you read in this run. Read "
    "the data, or work a figure out with calculate, then copy each value "
    "exactly as a tool returned it."
)
MAX_ROWS = 50
NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
COUNTS = {Decimal(count) for count in range(101)}

Id = Annotated[str, Field(min_length=1, max_length=40)]
Label = Annotated[str, Field(min_length=1, max_length=80)]
Text = Annotated[str, Field(max_length=200)]
Sentence = Annotated[str, Field(min_length=1, max_length=300)]
Cell = str | float | None


class Format(BaseModel):
    kind: Literal["text", "number", "currency", "percent", "date", "badge"]
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] | None = None
    basis: Literal["unit"] | None = None
    decimals: Annotated[int, Field(ge=0, le=4)] | None = None


class Column(BaseModel):
    key: Annotated[str, Field(max_length=64)]
    label: Text
    format: Format | None = None


class Detail(BaseModel):
    label: Text
    value: Text
    emphasis: bool = False


class Option(BaseModel):
    """One answer the user can pick."""

    id: Id
    label: Label
    description: Text


class Question(BaseModel):
    """One question and its answers. `multiple` lets the user pick several."""

    id: Id
    question: Sentence
    options: Annotated[list[Option], Field(min_length=2, max_length=6)]
    multiple: bool


class Compared(BaseModel):
    """One option in a comparison with traits aligned to labels."""

    id: Id
    name: Label
    headline: Label
    traits: Annotated[list[Annotated[str, Field(max_length=80)]], Field(max_length=6)]


class PlanItem(BaseModel):
    """One step of the plan and where it stands."""

    id: Id
    text: Label
    status: Literal["pending", "active", "done", "failed", "cancelled"]


class Section(BaseModel):
    """One section of a long answer: its heading, summary and the data it used."""

    id: Id
    heading: Label
    summary: Sentence
    sources: Annotated[list[Annotated[str, Field(max_length=60)]], Field(max_length=5)]


def message_text(item: object) -> str:
    """The text of a user's message the model reads, or empty for any other item.

    Only text counts: an image part's data URL is full of digits.
    """
    if not isinstance(item, dict) or item.get("role") != "user":
        return ""
    content = item.get("content")
    if isinstance(content, list):
        return " ".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") == "input_text"
        )
    return str(content or "")


class RecordReads(AgentHooks[RequestContext]):
    """Record tool outputs and user messages for display tool checks."""

    async def on_llm_start(
        self,
        context: RunContextWrapper[RequestContext],
        agent: Agent[RequestContext],
        system_prompt: str | None,
        input_items: list[Any],
    ) -> None:
        reads = context.context.reads
        for item in input_items:
            text = message_text(item)
            if text and text not in reads:
                reads.append(text)

    async def on_tool_end(
        self,
        context: RunContextWrapper[RequestContext],
        agent: Agent[RequestContext],
        tool: Tool,
        result: object,
    ) -> None:
        if tool.name not in DISPLAY_TOOLS:
            context.context.reads.append(str(result))


def numbers(text: str) -> set[Decimal]:
    """Every number written in `text`, with thousands separators dropped."""
    found = set()
    for token in NUMBER.findall(text):
        try:
            found.add(Decimal(token.replace(",", "")))
        except InvalidOperation:
            continue
    return found


def held_numbers(reads: list[str]) -> set[Decimal]:
    """Numbers display and calculation may use: from reads plus 0-100."""
    return numbers(" ".join(reads)) | COUNTS


def shown_numbers(value: object) -> list[Decimal]:
    """Every number in the values a display shows."""
    if isinstance(value, dict):
        value = list(value.values())
    if isinstance(value, list):
        return [number for item in value for number in shown_numbers(item)]
    if isinstance(value, bool) or value is None:
        return []
    if isinstance(value, int | float):
        return [Decimal(str(abs(value)))]
    return list(numbers(str(value)))


async def show(
    ctx: ToolContext[RequestContext],
    view: str,
    payload: dict[str, Any],
    checked: list[object],
    reply: str = SHOWN,
) -> str:
    """Emit the display if every number in `checked` is one the run's reads hold."""
    request = ctx.context
    held = held_numbers(request.reads)
    missing = [number for number in shown_numbers(checked) if number not in held]
    if missing:
        logger.warning(
            "Display refused",
            extra={
                "tool": ctx.tool_name,
                "status": "NOT_GROUNDED",
                "values": len(missing),
            },
        )
        return NOT_GROUNDED.format(count=len(missing))
    await request.emit(
        {
            "type": "display",
            "call_id": ctx.tool_call_id,
            "view": view,
            "payload": payload,
        }
    )
    return reply


@function_tool
async def show_table(
    ctx: ToolContext[RequestContext],
    step: Step,
    title: Text,
    columns: Annotated[list[Column], Field(min_length=1, max_length=8)],
    rows: Annotated[list[list[Cell]], Field(min_length=1, max_length=MAX_ROWS)],
) -> str:
    """Show the user rows you read as a table, when that answers better than a list.

    Copy each value exactly as a tool returned it. Every number must be one
    a tool returned: for a total or another figure you work out, use calculate
    first.

    Args:
        title: What the table shows, in everyday words.
        columns: The columns, in order. `key` names the field in each row.
            Use format currency, with the currency code, for amounts, percent
            with basis unit and 2 decimals for rates such as 2.10, and date
            for dates.
        rows: One list per row, with a value for each column, in the columns' order.
    """
    keys = [column.key for column in columns]
    shown = [dict(zip(keys, row, strict=False)) for row in rows]
    payload = {
        "title": title,
        "columns": [column.model_dump(exclude_none=True) for column in columns],
        "rows": shown,
    }
    return await show(ctx, "table", payload, [list(row.values()) for row in shown])


@function_tool
async def show_number(
    ctx: ToolContext[RequestContext], step: Step, label: Text, value: float
) -> str:
    """Show the user one figure you read, large.

    Args:
        label: What the figure is, in everyday words.
        value: The figure, exactly as the data holds it.
    """
    payload = {"label": label, "value": value}
    return await show(ctx, "number", payload, [value])


@function_tool
async def show_details(
    ctx: ToolContext[RequestContext],
    step: Step,
    title: Text,
    rows: Annotated[list[Detail], Field(min_length=1, max_length=12)],
    subtitle: Text | None = None,
) -> str:
    """Show the user one record you read as labelled values.

    Args:
        title: The record's name.
        rows: One label and value each, values copied from the data. Set
            emphasis on the one value that answers the question.
        subtitle: A short line under the title.
    """
    details = [row.model_dump() for row in rows]
    payload = {"title": title, "subtitle": subtitle, "rows": details}
    return await show(ctx, "details", payload, [row["value"] for row in details])


@function_tool
async def ask_user(
    ctx: ToolContext[RequestContext],
    step: Step,
    questions: Annotated[list[Question], Field(min_length=1, max_length=4)],
) -> str:
    """Ask the user to pick from a few answers instead of typing one.

    Use it when the answer is one of a few known values, such as which of
    several records they mean. Several questions show one at a time.

    Args:
        questions: The questions in the order they show, each with 2 to 6 answers.
    """
    shown = [question.model_dump() for question in questions]
    checked = [
        [option.label, option.description]
        for question in questions
        for option in question.options
    ]
    return await show(ctx, "questions", {"questions": shown}, checked, ASKED)


@function_tool
async def show_suggestion(
    ctx: ToolContext[RequestContext], step: Step, question: Sentence, reason: Sentence
) -> str:
    """Suggest one next step that changes nothing, for the user to accept or not.

    To make a change, call its propose tool instead.

    Args:
        question: The suggestion as a short question.
        reason: One or two sentences on why.
    """
    payload = {"question": question, "reason": reason}
    return await show(ctx, "suggestion", payload, [reason], ASKED)


@function_tool
async def show_comparison(
    ctx: ToolContext[RequestContext],
    step: Step,
    trait_labels: Annotated[list[Label], Field(min_length=1, max_length=6)],
    options: Annotated[list[Compared], Field(min_length=2, max_length=2)],
    recommended_id: Annotated[str, Field(max_length=40)],
    reason: Sentence,
) -> str:
    """Show two options you read side by side, trait by trait.

    Args:
        trait_labels: The traits every option is compared on, in order.
        options: The two options, each with one trait value per label.
        recommended_id: The id of the option you suggest, or empty for none.
        reason: One sentence on the difference that matters most.
    """
    payload = {
        "traitLabels": trait_labels,
        "options": [option.model_dump() for option in options],
        "recommendedId": recommended_id,
        "reason": reason,
    }
    checked = [[option.headline, option.traits] for option in options]
    return await show(ctx, "comparison", payload, checked)


@function_tool
async def update_plan(
    ctx: ToolContext[RequestContext],
    step: Step,
    title: Label,
    items: Annotated[list[PlanItem], Field(min_length=1, max_length=8)],
) -> str:
    """Show the user your plan for a request that takes three or more steps.

    Call it once with every step pending or active before you start, and again
    in the same response as the next step's tool call when a step ends. The app
    shows only the latest plan.

    Args:
        title: The plan's title, in a few everyday words.
        items: The steps in order, each pending, active, done, failed or cancelled.
    """
    payload = {"title": title, "items": [item.model_dump() for item in items]}
    return await show(ctx, "plan", payload, [])


@function_tool
async def show_report(
    ctx: ToolContext[RequestContext],
    step: Step,
    title: Label,
    sections: Annotated[list[Section], Field(min_length=1, max_length=6)],
) -> str:
    """Show an outline of a long answer in sections, each with the data it used.

    Call it once, just before the answer, with one section per part of the
    answer. A section's sources name the data you read for it, as the reads
    named it; the app keeps only sources this run read.

    Args:
        title: The answer's title, in a few everyday words.
        sections: The sections in the order the answer gives them.
    """
    read = {
        event["target"].rsplit(".", 1)[-1]
        for event in ctx.context.activity
        if event["outcome"] == "allowed"
        and event["tool"] != "model"
        and "proposal_id" not in event
    }
    shown = [
        section.model_dump()
        | {"sources": [name for name in section.sources if name in read]}
        for section in sections
    ]
    payload = {"title": title, "sections": shown, "sourcesRead": len(read)}
    return await show(ctx, "report", payload, [section.summary for section in sections])


DISPLAY_TOOLS = {
    tool.name
    for tool in (
        show_table,
        show_number,
        show_details,
        ask_user,
        show_suggestion,
        show_comparison,
        update_plan,
        show_report,
    )
}
