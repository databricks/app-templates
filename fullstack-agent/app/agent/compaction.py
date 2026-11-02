"""Replace a conversation's older items with one summary, so the model reads less."""

import json
import logging
from typing import Any

from agents import ModelRefusalError
from databricks.sdk.errors import DatabricksError
from databricks_agentkit.openai import session_store
from openai.types import CompletionUsage

from agent.agent import without_images
from agent.context import RequestContext
from agent.gateway import GatewayOpenAI
from agent.models import Model
from agent.prompts import prompt
from agent.settings import settings

KEPT_QUESTIONS = 2
SUMMARY_MAX_TOKENS = 1_000
SUMMARY_REQUEST = "Summarise our conversation so far."
logger = logging.getLogger(__name__)


def split_history(items: list[Any]) -> tuple[list[Any], list[Any]]:
    """Split history before the last KEPT_QUESTIONS; cut at user messages only."""
    questions = [
        index
        for index, item in enumerate(items)
        if item.get("role") == "user" and item.get("content") != SUMMARY_REQUEST
    ]
    if len(questions) <= KEPT_QUESTIONS:
        return [], items
    start = questions[-KEPT_QUESTIONS]
    return items[:start], items[start:]


async def compact(request: RequestContext, model: Model) -> CompletionUsage | None:
    """Summarize conversation older than kept questions. Clear and rewrite session."""
    session = session_store(request.session_id, await request.user_name())
    items = await session.get_items()
    older, kept = split_history(items)
    if not older:
        return None
    client = GatewayOpenAI(
        workspace_client=request.client_for("user"),
        use_ai_gateway=True,
    )
    try:
        response = await client.chat.completions.create(
            model=settings().model_service(model.id),
            messages=[
                {"role": "system", "content": prompt("compact")},
                {
                    "role": "user",
                    "content": json.dumps(
                        [without_images(item) for item in older], ensure_ascii=False
                    ),
                },
            ],
            max_tokens=SUMMARY_MAX_TOKENS,
        )
    finally:
        await client.close()
    choice = response.choices[0]
    if choice.finish_reason == "content_filter":
        raise ModelRefusalError("The provider's content filter withheld the summary.")
    summary = choice.message.content
    if not summary:
        raise ValueError("The model returned an empty summary; nothing was changed.")
    summarised = [
        {"role": "user", "content": SUMMARY_REQUEST},
        {"role": "assistant", "content": summary},
    ]
    await session.clear_session()
    try:
        await session.add_items(summarised + kept)
    except DatabricksError:
        await session.add_items(items)
        raise
    logger.info(
        "Conversation compacted",
        extra={"items_before": len(items), "items_after": len(summarised + kept)},
    )
    return response.usage
