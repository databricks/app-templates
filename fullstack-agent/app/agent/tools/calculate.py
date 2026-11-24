"""Exact arithmetic on numbers from reads using safe expression evaluation."""

import ast
import json
import logging
import operator
from decimal import ROUND_HALF_UP, Decimal, DecimalException, localcontext
from typing import Annotated

from agents import function_tool
from agents.tool_context import ToolContext
from pydantic import Field

from agent.context import RequestContext
from agent.tools import Step
from agent.tools.display import held_numbers

logger = logging.getLogger(__name__)

CONSTANTS = {Decimal(1000)}
MAX_EXPONENT = 1200
MAX_EXPRESSIONS = 50
MAX_RESULT = Decimal("1e15")
CENT = Decimal("0.01")
PRECISION = 34
OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}
NOT_HELD = (
    "Not calculated: it has a number that isn't in the data you read in this run "
    "or the user's messages. Use only those numbers, whole numbers up to a "
    "hundred, and a thousand."
)
NOT_ARITHMETIC = (
    "Not calculated: use only numbers, + - * / ** and parentheses, with each "
    "exponent a whole number up to twelve hundred."
)
NOT_FINITE = "Not calculated: it divides by zero or its result is too large."

Expression = Annotated[str, Field(min_length=1, max_length=200)]


class Refused(Exception):
    """An expression the tool doesn't work out, with the reason for the model."""


def evaluate(node: ast.expr, held: set[Decimal]) -> Decimal:
    """The value of one node of a parsed expression, using only `held` numbers."""
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        value = Decimal(str(node.value))
        if value not in held and value not in CONSTANTS:
            raise Refused(NOT_HELD)
        return value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -evaluate(node.operand, held)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
        exponent = evaluate(node.right, held)
        if exponent != exponent.to_integral_value() or not (
            0 <= exponent <= MAX_EXPONENT
        ):
            raise Refused(NOT_ARITHMETIC)
        return evaluate(node.left, held) ** int(exponent)
    if isinstance(node, ast.BinOp) and type(node.op) in OPERATORS:
        left = evaluate(node.left, held)
        return OPERATORS[type(node.op)](left, evaluate(node.right, held))
    raise Refused(NOT_ARITHMETIC)


def work_out(expression: str, held: set[Decimal]) -> str:
    """Evaluate expression and return value rounded to the cent."""
    try:
        tree = ast.parse(expression, mode="eval")
    except (SyntaxError, ValueError) as error:
        raise Refused(NOT_ARITHMETIC) from error
    with localcontext(prec=PRECISION):
        try:
            value = evaluate(tree.body, held)
        except DecimalException as error:
            raise Refused(NOT_FINITE) from error
        if abs(value) > MAX_RESULT:
            raise Refused(NOT_FINITE)
        return str(value.quantize(CENT, rounding=ROUND_HALF_UP))


@function_tool
async def calculate(
    ctx: ToolContext[RequestContext],
    step: Step,
    expressions: Annotated[
        list[Expression], Field(min_length=1, max_length=MAX_EXPRESSIONS)
    ],
) -> str:
    """Work out figures exactly. Use it for every figure you calculate.

    Write each figure as one expression with numbers, + - * / ** and
    parentheses. Use only numbers from your tools' output in this run or the
    user's messages, whole numbers up to 100, and 1000. Write 10k as
    10*1000 and 5% as 5/100. An exponent works out to a whole number of at
    most 1200, such as (1+5/100/12)**(12*6) for 6 years of months.

    Args:
        expressions: The figures to work out, at most 50.

    Returns:
        A JSON list with one result per expression, in order: its value rounded
        to the cent, or why it wasn't worked out.
    """
    held = held_numbers(ctx.context.reads)
    results: list[str] = []
    refused = 0
    for expression in expressions:
        try:
            results.append(work_out(expression, held))
        except Refused as refusal:
            results.append(str(refusal))
            refused += 1
    if refused:
        logger.warning(
            "Calculation refused",
            extra={
                "tool": ctx.tool_name,
                "status": "NOT_CALCULATED",
                "values": refused,
            },
        )
    return json.dumps(results)
