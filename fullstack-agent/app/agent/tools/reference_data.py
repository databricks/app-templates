import asyncio
import json

from agents import function_tool
from agents.tool_context import ToolContext
from databricks.sdk import WorkspaceClient

from agent.context import RequestContext
from agent.settings import settings
from agent.statement_execution import QueryFailed, report_read_failure, run_query
from agent.tools import Step

UNAVAILABLE = "Product rates are unavailable right now."
PRODUCTS_QUERY = (
    "SELECT product_id, name, type, rate_pct, monthly_fee, terms "
    "FROM {table} ORDER BY product_id"
)


def products_table() -> str:
    return f"{settings().reference_schema}.products"


def read_products(client: WorkspaceClient) -> list[dict[str, str | None]]:
    """Read the shared product table. Only the app identity holds a grant on it."""
    return run_query(client, PRODUCTS_QUERY.format(table=products_table()))


@function_tool
async def product_rates(ctx: ToolContext[RequestContext], step: Step) -> str:
    """Return Bank's products with their interest rates, fees and terms."""
    request = ctx.context
    target = f"{settings().catalog}.{products_table()}"
    try:
        products = await asyncio.to_thread(read_products, request.client_for("app"))
    except QueryFailed as error:
        event_kwargs = {"call_id": ctx.tool_call_id}
        if error.is_wait_limit:
            event_kwargs["code"] = "QUERY_TIMEOUT"
        await request.tool_event(
            "product_rates",
            "app",
            target,
            "denied",
            **event_kwargs,
        )
        report_read_failure(error, "product_rates", target)
        return UNAVAILABLE
    await request.tool_event(
        "product_rates", "app", target, "allowed", call_id=ctx.tool_call_id
    )
    return json.dumps(products)
