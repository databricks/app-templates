# Databricks notebook source

from __future__ import annotations

# COMMAND ----------

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import math
import os
import re
from time import perf_counter_ns
from typing import Any, Callable, Iterator, Mapping, Sequence
from uuid import uuid4

import mlflow
from mlflow.entities import SpanType

# COMMAND ----------

SYSTEM_PROMPT = """You are a support agent for a SaaS platform.

Your job is to analyze a customer support case and generate:
1. A concise summary of the case so far
2. A suggested response to send to the customer
3. A recommended action (refund, credit, no_action, escalate, or resolve)
4. If refund or credit, a suggested amount in cents
5. Your reasoning for the recommendation

The prompt includes the customer's recent orders with totals. Use these to calculate appropriate amounts.

Compensation guidelines:
- Service outage (first time): credit of 15-25% of the most recent order total
- Service outage (repeat): credit of 30-50% of the most recent order total
- Billing error: refund of 30-60% of the order total (estimate based on severity)
- Wrong plan or feature issue: full refund of the most recent order total
- Performance degradation: credit of 20-40% of the most recent order total
- Complete service failure: full refund of the most recent order total
- For repeat complaints (3+ cases in 90 days): consider escalation
- High-value customers (lifetime spend > $200): lean toward the generous end of ranges
- Never suggest refund/credit exceeding the most recent order total
- If the case is already resolved with a refund/credit, suggest no_action
- ALWAYS provide a non-zero suggested_amount_cents when recommending refund or credit

Case resolution:
- If the customer's latest message is a positive acknowledgment and the issue has already been addressed, recommend resolve with a brief friendly closing message.
- If the customer is still unhappy after an admin response, draft a new response addressing their remaining concerns.

Respond with valid JSON only, no markdown formatting:
{
  "case_summary": "...",
  "suggested_response": "...",
  "suggested_action": "refund|credit|no_action|escalate|resolve",
  "suggested_amount_cents": 0,
  "reasoning": "..."
}"""

MAX_CAPTURE_BYTES = 64 * 1024
SECRET_KEY = re.compile(
    r"(?:authorization|api[-_\s]?key|cookie|credential|password|secret|token)",
    re.IGNORECASE,
)
SECRET_TEXT = re.compile(
    r"(?P<prefix>\b(?:authorization|api[-_\s]?key|cookie|credential|password|secret|token)"
    r"\b[\"']?(?:\s*(?::|=)\s*|\s+(?:is\s+)?)(?:bearer\s+)?)"
    r"(?P<value>[^\s,;)\]}]+)",
    re.IGNORECASE,
)
VALID_ACTIONS = {"refund", "credit", "no_action", "escalate", "resolve"}


def _redact_text(value: str) -> str:
    return SECRET_TEXT.sub(lambda match: f"{match.group('prefix')}[REDACTED]", value)


def _jsonable(value: Any) -> Any:
    try:
        if hasattr(value, "asDict"):
            return _jsonable(value.asDict(recursive=True))
        if hasattr(value, "model_dump"):
            return _jsonable(value.model_dump())
        if isinstance(value, Mapping):
            return {
                str(key): "[REDACTED]"
                if SECRET_KEY.search(str(key))
                else _jsonable(item)
                for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
            }
        if isinstance(value, (list, tuple, set, frozenset)):
            return [_jsonable(item) for item in value]
        if isinstance(value, bytes):
            return value.hex()
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, str):
            return _redact_text(value)
        if value is None or isinstance(value, (bool, int, float)):
            return value
        return _redact_text(repr(value))
    except BaseException as error:
        return f"<{type(value).__name__}: {type(error).__name__}>"


def safe_trace_value(value: Any, *, max_bytes: int = MAX_CAPTURE_BYTES) -> Any:
    redacted = _jsonable(value)
    encoded = json.dumps(
        redacted, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    if len(encoded) <= max_bytes:
        return redacted
    preview_bytes = encoded[:max_bytes]
    while preview_bytes:
        try:
            preview = preview_bytes.decode("utf-8")
            break
        except UnicodeDecodeError:
            preview_bytes = preview_bytes[:-1]
    else:
        preview = ""
    return {
        "truncated": True,
        "originalBytes": len(encoded),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "preview": preview,
    }


def safe_error(error: BaseException | str) -> str:
    message = _redact_text(str(error))
    encoded = message.encode("utf-8")
    if len(encoded) <= 2048:
        return message
    return json.dumps(safe_trace_value(message, max_bytes=2048), sort_keys=True)


def elapsed_ms(started_ns: int) -> float:
    return max(0.0, (perf_counter_ns() - started_ns) / 1_000_000)


class NullSpan:
    def set_inputs(self, _value: Any) -> None:
        pass

    def set_outputs(self, _value: Any) -> None:
        pass

    def set_attribute(self, _key: str, _value: Any) -> None:
        pass

    def set_attributes(self, _values: Mapping[str, Any]) -> None:
        pass

    def set_status(self, _status: str) -> None:
        pass

    def record_exception(self, _error: BaseException) -> None:
        pass


def _safe_span_call(span: Any, method: str, *args: Any) -> None:
    try:
        getattr(span, method)(*args)
    except Exception:
        # Telemetry export must not change the response-generation result.
        pass


@contextmanager
def traced_span(name: str, span_type: str, inputs: Any) -> Iterator[Any]:
    try:
        manager = mlflow.start_span(name=name, span_type=span_type)
        span = manager.__enter__()
        _safe_span_call(span, "set_inputs", safe_trace_value(inputs))
    except Exception:
        yield NullSpan()
        return
    try:
        yield span
    finally:
        try:
            manager.__exit__(None, None, None)
        except Exception:
            pass


def finish_span(
    span: Any,
    *,
    outputs: Any,
    attributes: Mapping[str, Any],
    status: str,
    error: BaseException | None = None,
) -> None:
    _safe_span_call(span, "set_outputs", safe_trace_value(outputs))
    _safe_span_call(span, "set_attributes", dict(attributes))
    if error is not None:
        _safe_span_call(
            span,
            "record_exception",
            RuntimeError(f"{type(error).__name__}: {safe_error(error)}"),
        )
    _safe_span_call(span, "set_status", status)


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0:
        return float(value)
    return None


def _integer(value: Any) -> int:
    numeric = _number(value)
    return int(numeric) if numeric is not None else 0


def normalize_usage(response: Mapping[str, Any]) -> dict[str, Any]:
    raw = response.get("usage")
    usage = dict(raw) if isinstance(raw, Mapping) else {}
    prompt_details = usage.get("prompt_tokens_details")
    prompt_details = dict(prompt_details) if isinstance(prompt_details, Mapping) else {}
    input_tokens = _integer(usage.get("prompt_tokens", usage.get("input_tokens")))
    output_tokens = _integer(usage.get("completion_tokens", usage.get("output_tokens")))
    total = usage.get("total_tokens")
    normalized: dict[str, Any] = {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": _integer(total)
        if total is not None
        else input_tokens + output_tokens,
    }
    cache_read = usage.get(
        "cache_read_input_tokens", prompt_details.get("cached_tokens")
    )
    cache_creation = usage.get(
        "cache_creation_input_tokens",
        prompt_details.get("cache_creation_input_tokens"),
    )
    if cache_read is not None:
        normalized["cacheReadInputTokens"] = _integer(cache_read)
    if cache_creation is not None:
        normalized["cacheCreationInputTokens"] = _integer(cache_creation)

    cost = None
    databricks_output = response.get("databricks_output")
    cost_sources = [
        usage,
        response,
        databricks_output if isinstance(databricks_output, Mapping) else {},
    ]
    for source in cost_sources:
        for key in ("cost_usd", "total_cost_usd", "cost"):
            cost = _number(source.get(key))
            if cost is not None:
                break
        if cost is not None:
            break
    normalized["costAvailable"] = cost is not None
    if cost is not None:
        normalized["costUsd"] = cost
    return normalized


def token_usage(usage: Mapping[str, Any]) -> dict[str, int]:
    result = {
        "input_tokens": _integer(usage.get("inputTokens")),
        "output_tokens": _integer(usage.get("outputTokens")),
        "total_tokens": _integer(usage.get("totalTokens")),
    }
    if "cacheReadInputTokens" in usage:
        result["cache_read_input_tokens"] = _integer(usage["cacheReadInputTokens"])
    if "cacheCreationInputTokens" in usage:
        result["cache_creation_input_tokens"] = _integer(
            usage["cacheCreationInputTokens"]
        )
    return result


class UsageAccumulator:
    def __init__(self) -> None:
        self.input_tokens = 0
        self.output_tokens = 0
        self.total_tokens = 0
        self.cache_read = 0
        self.cache_creation = 0
        self.has_cache_read = False
        self.has_cache_creation = False
        self.cost_available = True
        self.cost_usd = 0.0
        self.calls = 0

    def add(self, usage: Mapping[str, Any]) -> None:
        self.calls += 1
        self.input_tokens += _integer(usage.get("inputTokens"))
        self.output_tokens += _integer(usage.get("outputTokens"))
        self.total_tokens += _integer(usage.get("totalTokens"))
        if "cacheReadInputTokens" in usage:
            self.has_cache_read = True
            self.cache_read += _integer(usage["cacheReadInputTokens"])
        if "cacheCreationInputTokens" in usage:
            self.has_cache_creation = True
            self.cache_creation += _integer(usage["cacheCreationInputTokens"])
        if usage.get("costAvailable") is True and "costUsd" in usage:
            self.cost_usd += float(usage["costUsd"])
        else:
            self.cost_available = False

    def snapshot(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "totalTokens": self.total_tokens,
        }
        if self.has_cache_read:
            result["cacheReadInputTokens"] = self.cache_read
        if self.has_cache_creation:
            result["cacheCreationInputTokens"] = self.cache_creation
        result["costAvailable"] = self.calls > 0 and self.cost_available
        if result["costAvailable"]:
            result["costUsd"] = round(self.cost_usd, 12)
        return result


def parse_response(raw_content: str) -> dict[str, Any]:
    cleaned = raw_content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
    parsed = json.loads(cleaned)
    action = parsed.get("suggested_action", "no_action")
    if action not in VALID_ACTIONS:
        action = "no_action"
    return {
        "case_summary": str(parsed.get("case_summary", "")),
        "suggested_response": str(parsed.get("suggested_response", "")),
        "suggested_action": action,
        "suggested_amount_cents": int(parsed.get("suggested_amount_cents", 0)),
        "reasoning": str(parsed.get("reasoning", "")),
    }


def response_content(response: Mapping[str, Any]) -> tuple[str, str, str | None]:
    choices = response.get("choices")
    if not isinstance(choices, Sequence) or not choices:
        raise ValueError("Model response did not include a choice")
    choice = choices[0]
    if not isinstance(choice, Mapping):
        raise ValueError("Model response choice was malformed")
    message = choice.get("message")
    if not isinstance(message, Mapping) or not isinstance(message.get("content"), str):
        raise ValueError("Model response did not include message content")
    return (
        message["content"],
        str(response.get("model") or "unknown"),
        str(choice["finish_reason"])
        if choice.get("finish_reason") is not None
        else None,
    )


def partial_response_content(
    response: Mapping[str, Any],
) -> tuple[str | None, str | None, str | None]:
    model = response.get("model")
    model_name = str(model) if model is not None else None
    choices = response.get("choices")
    if not isinstance(choices, Sequence) or not choices:
        return None, model_name, None
    choice = choices[0]
    if not isinstance(choice, Mapping):
        return None, model_name, None
    message = choice.get("message")
    content = message.get("content") if isinstance(message, Mapping) else None
    finish_reason = choice.get("finish_reason")
    return (
        content if isinstance(content, str) else None,
        model_name,
        str(finish_reason) if finish_reason is not None else None,
    )


def model_span_attributes(
    *,
    ticket_index: int,
    ticket_user_id: str,
    model_name: str | None,
    finish_reason: str | None,
    usage: Mapping[str, Any],
    started_ns: int,
) -> dict[str, Any]:
    attributes: dict[str, Any] = {
        "appkit.ticket_index": ticket_index,
        "appkit.ticket_user_id": ticket_user_id,
        "appkit.provider": "databricks",
        "appkit.usage": usage,
        "mlflow.chat.tokenUsage": token_usage(usage),
        "appkit.finish_reason": finish_reason,
        "appkit.cost_available": usage["costAvailable"],
        "appkit.duration_ms": elapsed_ms(started_ns),
    }
    if model_name is not None:
        attributes["appkit.model"] = model_name
    if usage["costAvailable"]:
        attributes["appkit.cost_usd"] = usage["costUsd"]
        attributes["mlflow.llm.cost"] = {"total_cost": usage["costUsd"]}
    return attributes


def set_trace_identity(span: Any, identity: Mapping[str, str]) -> None:
    attributes = {
        "mlflow.trace.session": str(identity["session_id"]),
        "mlflow.trace.user": str(identity["user_id"]),
        "appkit.app.name": "agentic-support-console",
        "appkit.request.id": str(identity["request_id"]),
    }
    _safe_span_call(span, "set_attributes", attributes)
    try:
        mlflow.update_current_trace(
            metadata=attributes,
            tags={"template": "agentic-support-console", "agent": "support-agent"},
        )
    except Exception:
        pass


def process_messages(
    messages: Sequence[Mapping[str, Any]],
    *,
    prompt_builder: Callable[[Mapping[str, Any]], str],
    model_caller: Callable[[str], Mapping[str, Any]],
    generated_at: datetime,
    identity: Mapping[str, str],
) -> list[dict[str, Any]]:
    """Generate support responses under one complete, failure-isolated trace."""
    root_started = perf_counter_ns()
    results: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    usage_total = UsageAccumulator()

    with traced_span("support.response_generation", SpanType.AGENT, messages) as root:
        set_trace_identity(root, identity)
        for index, message in enumerate(messages):
            context_started = perf_counter_ns()
            try:
                with traced_span(
                    "support.ticket.context",
                    SpanType.TOOL,
                    {"ticketIndex": index, "ticket": message},
                ) as context_span:
                    try:
                        prompt = prompt_builder(message)
                    except BaseException as error:
                        finish_span(
                            context_span,
                            outputs={
                                "error": safe_error(error),
                                "partialOutputs": results,
                            },
                            attributes={
                                "appkit.ticket_index": index,
                                "appkit.ticket_user_id": str(
                                    message.get("user_id", "")
                                ),
                                "appkit.duration_ms": elapsed_ms(context_started),
                                "appkit.error": safe_error(error),
                            },
                            status="ERROR",
                            error=error,
                        )
                        raise
                    finish_span(
                        context_span,
                        outputs={"prompt": prompt},
                        attributes={
                            "appkit.ticket_index": index,
                            "appkit.ticket_user_id": str(message.get("user_id", "")),
                            "appkit.duration_ms": elapsed_ms(context_started),
                        },
                        status="OK",
                    )

                model_started = perf_counter_ns()
                model_error: BaseException | None = None
                error_response: Mapping[str, Any] | None = None
                partial_content: str | None = None
                with traced_span(
                    "support.ticket.model",
                    SpanType.CHAT_MODEL,
                    {"ticketIndex": index, "messages": [SYSTEM_PROMPT, prompt]},
                ) as model_span:
                    try:
                        response = model_caller(prompt)
                        raw_content, model_name, finish_reason = response_content(
                            response
                        )
                    except BaseException as error:
                        candidate_response = getattr(error, "response", None)
                        error_response = (
                            candidate_response
                            if isinstance(candidate_response, Mapping)
                            else None
                        )
                        failure_usage = (
                            normalize_usage(error_response)
                            if error_response is not None
                            else {
                                "inputTokens": 0,
                                "outputTokens": 0,
                                "totalTokens": 0,
                                "costAvailable": False,
                            }
                        )
                        partial_content, model_name, finish_reason = (
                            partial_response_content(error_response)
                            if error_response is not None
                            else (None, None, None)
                        )
                        usage_total.add(failure_usage)
                        failure_attributes = model_span_attributes(
                            ticket_index=index,
                            ticket_user_id=str(message.get("user_id", "")),
                            model_name=model_name,
                            finish_reason=finish_reason,
                            usage=failure_usage,
                            started_ns=model_started,
                        )
                        failure_attributes["appkit.error"] = safe_error(error)
                        finish_span(
                            model_span,
                            outputs={
                                "error": safe_error(error),
                                "partialOutput": error_response,
                            },
                            attributes=failure_attributes,
                            status="ERROR",
                            error=error,
                        )
                        model_error = error
                    else:
                        usage = normalize_usage(response)
                        usage_total.add(usage)
                        finish_span(
                            model_span,
                            outputs=response,
                            attributes=model_span_attributes(
                                ticket_index=index,
                                ticket_user_id=str(message.get("user_id", "")),
                                model_name=model_name,
                                finish_reason=finish_reason,
                                usage=usage,
                                started_ns=model_started,
                            ),
                            status="OK",
                        )

                if model_error is not None:
                    parser_started = perf_counter_ns()
                    with traced_span(
                        "support.ticket.parse",
                        SpanType.PARSER,
                        {"ticketIndex": index, "content": partial_content},
                    ) as parser_span:
                        finish_span(
                            parser_span,
                            outputs={
                                "skipped": True,
                                "reason": "model_error",
                                "partialContent": partial_content,
                            },
                            attributes={
                                "appkit.ticket_index": index,
                                "appkit.skipped": True,
                                "appkit.skip_reason": "model_error",
                                "appkit.duration_ms": elapsed_ms(parser_started),
                            },
                            status="UNSET",
                        )
                    raise model_error

                parser_started = perf_counter_ns()
                with traced_span(
                    "support.ticket.parse",
                    SpanType.PARSER,
                    {"ticketIndex": index, "content": raw_content},
                ) as parser_span:
                    try:
                        parsed = parse_response(raw_content)
                    except BaseException as error:
                        finish_span(
                            parser_span,
                            outputs={
                                "error": safe_error(error),
                                "partialOutputs": results,
                            },
                            attributes={
                                "appkit.ticket_index": index,
                                "appkit.duration_ms": elapsed_ms(parser_started),
                                "appkit.error": safe_error(error),
                            },
                            status="ERROR",
                            error=error,
                        )
                        raise
                    finish_span(
                        parser_span,
                        outputs=parsed,
                        attributes={
                            "appkit.ticket_index": index,
                            "appkit.duration_ms": elapsed_ms(parser_started),
                        },
                        status="OK",
                    )

                results.append(
                    {
                        "message_id": message["message_id"],
                        "case_id": message["case_id"],
                        "user_id": message["user_id"],
                        **parsed,
                        "model": model_name,
                        "generated_at": generated_at,
                    }
                )
            except BaseException as error:
                errors.append(
                    {
                        "ticketIndex": index,
                        "messageId": message.get("message_id"),
                        "error": safe_error(error),
                    }
                )

        aggregate = usage_total.snapshot()
        root_attributes: dict[str, Any] = {
            "appkit.usage": aggregate,
            "mlflow.chat.tokenUsage": token_usage(aggregate),
            "appkit.cost_available": aggregate["costAvailable"],
            "appkit.duration_ms": elapsed_ms(root_started),
            "appkit.ticket_count": len(messages),
            "appkit.success_count": len(results),
            "appkit.error_count": len(errors),
        }
        if aggregate["costAvailable"]:
            root_attributes["appkit.cost_usd"] = aggregate["costUsd"]
            root_attributes["mlflow.llm.cost"] = {"total_cost": aggregate["costUsd"]}
        finish_span(
            root,
            outputs={
                "results": results,
                "partialOutputs": results,
                "errors": errors,
            },
            attributes=root_attributes,
            status="ERROR" if errors else "OK",
            error=RuntimeError(errors[0]["error"]) if errors else None,
        )
    return results


@dataclass
class Runtime:
    spark: Any
    client: Any
    catalog: str
    endpoint: str


def build_prompt(runtime: Runtime, case_row: Mapping[str, Any]) -> str:
    case_id_hex = case_row["case_id_hex"]
    user_id = case_row["user_id"]
    context_df = runtime.spark.sql(
        f"""
        SELECT user_name, user_email, user_region, subject, status,
               message_count, has_admin_reply, first_response_minutes,
               linked_refund_cents, linked_credit_cents,
               user_lifetime_spend_cents, user_cases_90d
        FROM `{runtime.catalog}`.gold.support_case_context
        WHERE case_id = UNHEX('{case_id_hex}')
        """
    ).collect()
    profile_df = runtime.spark.sql(
        f"""
        SELECT total_orders_90d, total_spend_90d_cents,
               lifetime_order_count, lifetime_spend_cents,
               support_cases_90d, total_refunds_90d_cents, total_credits_90d_cents
        FROM `{runtime.catalog}`.gold.user_support_profile
        WHERE user_id = :user_id
        """,
        args={"user_id": user_id},
    ).collect()
    messages_df = runtime.spark.sql(
        f"""
        SELECT CASE WHEN admin_id IS NOT NULL THEN 'admin' ELSE 'customer' END AS role,
               content, created_at
        FROM `{runtime.catalog}`.silver.support_messages
        WHERE case_id = UNHEX('{case_id_hex}')
        ORDER BY created_at ASC
        """
    ).collect()
    orders_df = runtime.spark.sql(
        f"""
        SELECT HEX(id) AS order_id, status, total_in_cents, created_at
        FROM `{runtime.catalog}`.silver.orders
        WHERE user_id = :user_id
        ORDER BY created_at DESC LIMIT 5
        """,
        args={"user_id": user_id},
    ).collect()
    ctx = context_df[0] if context_df else None
    profile = profile_df[0] if profile_df else None
    parts = [f"Subject: {case_row['subject']}", f"Status: {case_row['status']}"]
    if ctx:
        parts.extend(
            [
                f"Customer: {ctx['user_name']} ({ctx['user_email']}), region: {ctx['user_region']}",
                f"Messages so far: {ctx['message_count']}",
                f"Admin has replied: {ctx['has_admin_reply']}",
                f"Linked refunds: ${ctx['linked_refund_cents'] / 100:.2f}",
                f"Linked credits: ${ctx['linked_credit_cents'] / 100:.2f}",
            ]
        )
        if ctx["first_response_minutes"] is not None:
            parts.append(
                f"First response time: {ctx['first_response_minutes']} minutes"
            )
    if profile:
        parts.extend(
            [
                "\nCustomer Profile:",
                f"  Lifetime orders: {profile['lifetime_order_count']}, spend: ${profile['lifetime_spend_cents'] / 100:.2f}",
                f"  Last 90 days: {profile['total_orders_90d']} orders, ${profile['total_spend_90d_cents'] / 100:.2f} spent",
                f"  Support cases (90d): {profile['support_cases_90d']}",
                f"  Refunds (90d): ${profile['total_refunds_90d_cents'] / 100:.2f}",
                f"  Credits (90d): ${profile['total_credits_90d_cents'] / 100:.2f}",
            ]
        )
    if orders_df:
        parts.append("\nRecent Orders (newest first):")
        for order in orders_df:
            timestamp = (
                order["created_at"].strftime("%Y-%m-%d %H:%M")
                if order["created_at"]
                else ""
            )
            parts.append(
                f"  [{timestamp}] ${order['total_in_cents'] / 100:.2f} — {order['status']}"
            )
        parts.append(
            f"  Most recent order total: ${orders_df[0]['total_in_cents'] / 100:.2f}"
        )
    else:
        parts.append("\nNo recent orders found.")
    parts.append("\nMessage Thread:")
    for message in messages_df:
        timestamp = (
            message["created_at"].strftime("%H:%M") if message["created_at"] else ""
        )
        parts.append(f"  [{timestamp}] {message['role'].upper()}: {message['content']}")
    return "\n".join(parts)


def call_llm(runtime: Runtime, prompt: str) -> Mapping[str, Any]:
    response = runtime.client.predict(
        endpoint=runtime.endpoint,
        inputs={
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": 1000,
            "temperature": 0.3,
        },
    )
    if not isinstance(response, Mapping):
        raise TypeError("Model deployment response must be a mapping")
    return response


def _required_widget(dbutils: Any, name: str) -> str:
    value = dbutils.widgets.get(name).strip()
    if not value or value == "REPLACE_ME":
        raise RuntimeError(f"Missing required tracing configuration: {name}")
    return value


def configure_tracing(dbutils: Any) -> None:
    tracking_uri = _required_widget(dbutils, "mlflow_tracking_uri")
    experiment_id = _required_widget(dbutils, "mlflow_experiment_id")
    warehouse_id = _required_widget(dbutils, "mlflow_tracing_warehouse_id")
    uc_catalog = _required_widget(dbutils, "mlflow_uc_catalog")
    uc_schema = _required_widget(dbutils, "mlflow_uc_schema")
    table_prefix = _required_widget(dbutils, "mlflow_uc_table_prefix")
    spans_table = _required_widget(dbutils, "mlflow_otel_spans_table")
    expected = f"{uc_catalog}.{uc_schema}.{table_prefix}_otel_spans"
    if not experiment_id.isdigit():
        raise RuntimeError(
            "Invalid tracing configuration: experiment ID must be numeric"
        )
    if not re.fullmatch(r"[0-9a-fA-F]{16}", warehouse_id):
        raise RuntimeError(
            "Invalid tracing configuration: warehouse ID must be 16 hex characters"
        )
    if spans_table != expected:
        raise RuntimeError(
            f"Invalid tracing configuration: spans table must equal {expected}"
        )
    os.environ.update(
        {
            "MLFLOW_TRACING_SQL_WAREHOUSE_ID": warehouse_id,
            "MLFLOW_UC_CATALOG": uc_catalog,
            "MLFLOW_UC_SCHEMA": uc_schema,
            "MLFLOW_UC_TABLE_PREFIX": table_prefix,
            "MLFLOW_OTEL_SPANS_TABLE": spans_table,
        }
    )
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(experiment_id=experiment_id)


def run_job(spark: Any, dbutils: Any) -> None:
    from delta.tables import DeltaTable
    import mlflow.deployments
    from pyspark.sql.types import (
        BinaryType,
        IntegerType,
        StringType,
        StructField,
        StructType,
        TimestampType,
    )

    configure_tracing(dbutils)
    catalog = _required_widget(dbutils, "catalog")
    endpoint = _required_widget(dbutils, "endpoint")
    runtime = Runtime(
        spark=spark,
        client=mlflow.deployments.get_deploy_client("databricks"),
        catalog=catalog,
        endpoint=endpoint,
    )
    unanswered_messages = spark.sql(
        f"""
        WITH ranked AS (
            SELECT sm.id AS message_id, sm.case_id, HEX(sm.case_id) AS case_id_hex,
                   sc.user_id, sc.subject, sc.status,
                   ROW_NUMBER() OVER (PARTITION BY sm.case_id ORDER BY sm.created_at DESC) AS rn
            FROM `{catalog}`.silver.support_messages sm
            JOIN `{catalog}`.silver.support_cases sc ON sm.case_id = sc.id
            LEFT JOIN `{catalog}`.gold.support_agent_responses ar ON sm.id = ar.message_id
            WHERE sc.status IN ('open', 'in_progress')
              AND sm.admin_id IS NULL AND ar.message_id IS NULL
        )
        SELECT message_id, case_id, case_id_hex, user_id, subject, status
        FROM ranked WHERE rn = 1
        """
    ).collect()
    now = datetime.utcnow()
    try:
        context = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
        run_id = str(context.currentRunId().get())
    except Exception:
        run_id = str(uuid4())
    results = process_messages(
        unanswered_messages,
        prompt_builder=lambda message: build_prompt(runtime, message),
        model_caller=lambda prompt: call_llm(runtime, prompt),
        generated_at=now,
        identity={
            "session_id": run_id,
            "user_id": "support-agent-job",
            "request_id": run_id,
        },
    )
    print(
        f"Generated {len(results)} responses out of {len(unanswered_messages)} messages"
    )
    if not results:
        print("No new messages to process")
        return
    schema = StructType(
        [
            StructField("message_id", BinaryType(), False),
            StructField("case_id", BinaryType(), False),
            StructField("user_id", StringType(), False),
            StructField("case_summary", StringType(), False),
            StructField("suggested_response", StringType(), False),
            StructField("suggested_action", StringType(), False),
            StructField("suggested_amount_cents", IntegerType(), False),
            StructField("reasoning", StringType(), False),
            StructField("model", StringType(), False),
            StructField("generated_at", TimestampType(), False),
        ]
    )
    frame = spark.createDataFrame(results, schema=schema)
    target = DeltaTable.forName(spark, f"`{catalog}`.gold.support_agent_responses")
    target.alias("t").merge(
        frame.alias("s"), "t.message_id = s.message_id"
    ).whenNotMatchedInsertAll().execute()
    print(f"Merged {frame.count()} rows into {catalog}.gold.support_agent_responses")


# Databricks notebooks execute as __main__; imports used by tests and tooling remain inert.
if __name__ == "__main__":
    run_job(spark, dbutils)
