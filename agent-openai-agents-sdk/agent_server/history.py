"""Conversation-history normalization helpers.

Kept dependency-free (no Databricks SDK / MLflow imports) so it can be unit
tested in isolation without live workspace credentials.
"""


def normalize_history_items(messages: list[dict]) -> list[dict]:
    """Work around BL-18196.

    openai-agents >= 0.19 (commit fa1001d) tightened
    ``Converter.maybe_response_output_message`` to require ``{"id", "content"}``
    on assistant history items. The built-in chat UI replays the prior assistant
    turn as an id-less ``{"type": "message", "role": "assistant",
    "content": [output_text]}`` item, and MLflow's ``ResponsesAgentRequest``
    strips any client-supplied ``id``, so on the 2nd+ prompt the item fails
    recognition and hits the catch-all ``UserError: Unhandled item type or
    structure``.

    Collapse those replayed assistant items to the easy-input
    ``{"role", "content"}`` form, which is recognized by
    ``maybe_easy_input_message`` (no id required), sidestepping the tightened
    guard regardless of SDK version. Multiple ``output_text`` segments are joined
    with ``"\\n"`` to match the SDK converter's own behavior byte-for-byte.
    """
    normalized: list[dict] = []
    for m in messages:
        if (
            m.get("type") == "message"
            and m.get("role") == "assistant"
            and isinstance(m.get("content"), list)
        ):
            text = "\n".join(
                part.get("text", "")
                for part in m["content"]
                if isinstance(part, dict) and part.get("type") == "output_text"
            )
            normalized.append({"role": "assistant", "content": text})
        else:
            normalized.append(m)
    return normalized
