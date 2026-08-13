"""MLflow tracing startup, redaction, and W3C context for the MCP server."""

from __future__ import annotations

import ast
import hashlib
import inspect
import json
import logging
import os
import re
from contextlib import contextmanager, nullcontext
from contextvars import ContextVar
from dataclasses import asdict, is_dataclass
from functools import wraps
from time import perf_counter_ns
from typing import Any, Callable, Iterator, Mapping

import mlflow
from mlflow.tracing import set_tracing_context_from_http_request_headers
from opentelemetry import trace
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

logger = logging.getLogger(__name__)

REQUIRED_TRACING_ENV = (
    "MLFLOW_TRACKING_URI",
    "MLFLOW_EXPERIMENT_ID",
    "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
    "MLFLOW_UC_CATALOG",
    "MLFLOW_UC_SCHEMA",
    "MLFLOW_UC_TABLE_PREFIX",
    "MLFLOW_OTEL_SPANS_TABLE",
)

_MAX_CAPTURE_BYTES = 64 * 1024
_EXPERIMENT_ID = re.compile(r"^[0-9]+$")
_WAREHOUSE_ID = re.compile(r"^[0-9a-f]{16}$", re.IGNORECASE)
_UC_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,254}$")
_SECRET_KEY = re.compile(
    r"(?:authorization|proxy[-_ ]?authorization|api[-_ ]?key|cookie|credential|"
    r"password|secret|sdk[-_ ]?token|token|access[-_ ]?key)",
    re.IGNORECASE,
)
_SECRET_TEXT = re.compile(
    r"(?P<prefix>\b(?:authorization|proxy[-_ ]?authorization|api[-_ ]?key|cookie|"
    r"credential|password|secret|sdk[-_ ]?token|token|access[-_ ]?key)\b[\"']?"
    r"\s*(?:(?:is|was|equals?)\s*|[:=]\s*)?(?:bearer\s+)?)"
    r"(?:(?P<quote>[\"'])(?P<quoted>(?:\\.|(?!(?P=quote))[^\\])*)(?P=quote)"
    r"|(?P<bare>[^\s,;)\]}]+))",
    re.IGNORECASE,
)
_request_context: ContextVar[dict[str, Any] | None] = ContextVar(
    "mcp_request_context", default=None
)


def validate_tracing_environment(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return valid tracing configuration or report every missing/invalid field."""
    source = os.environ if environ is None else environ
    config = {name: source.get(name, "").strip() for name in REQUIRED_TRACING_ENV}
    issues = [f"{name} is required" for name, value in config.items() if not value]

    experiment_id = config["MLFLOW_EXPERIMENT_ID"]
    if experiment_id and not _EXPERIMENT_ID.fullmatch(experiment_id):
        issues.append("MLFLOW_EXPERIMENT_ID must be numeric")
    warehouse_id = config["MLFLOW_TRACING_SQL_WAREHOUSE_ID"]
    if warehouse_id and not _WAREHOUSE_ID.fullmatch(warehouse_id):
        issues.append("MLFLOW_TRACING_SQL_WAREHOUSE_ID must be a 16-hex ID")
    for name in ("MLFLOW_UC_CATALOG", "MLFLOW_UC_SCHEMA", "MLFLOW_UC_TABLE_PREFIX"):
        if config[name] and not _UC_IDENTIFIER.fullmatch(config[name]):
            issues.append(f"{name} must be a simple UC identifier")

    if all(
        config[name] for name in ("MLFLOW_UC_CATALOG", "MLFLOW_UC_SCHEMA", "MLFLOW_UC_TABLE_PREFIX")
    ):
        expected_table = (
            f"{config['MLFLOW_UC_CATALOG']}.{config['MLFLOW_UC_SCHEMA']}."
            f"{config['MLFLOW_UC_TABLE_PREFIX']}_otel_spans"
        )
        spans_table = config["MLFLOW_OTEL_SPANS_TABLE"]
        if spans_table and spans_table != expected_table:
            issues.append(
                "MLFLOW_OTEL_SPANS_TABLE must equal "
                "<MLFLOW_UC_CATALOG>.<MLFLOW_UC_SCHEMA>."
                "<MLFLOW_UC_TABLE_PREFIX>_otel_spans"
            )
    if issues:
        raise RuntimeError("Invalid tracing configuration: " + "; ".join(issues))
    return config


def configure_mlflow_tracing() -> None:
    """Initialize MLflow only after mandatory deployment configuration is valid."""
    config = validate_tracing_environment()
    mlflow.set_tracking_uri(config["MLFLOW_TRACKING_URI"])
    if config["MLFLOW_TRACKING_URI"].startswith("databricks"):
        verify_deployment_trace_resources(config)
    mlflow.set_experiment(experiment_id=config["MLFLOW_EXPERIMENT_ID"])


def verify_deployment_trace_resources(
    config: Mapping[str, str], *, mlflow_client=None, workspace_client=None
) -> None:
    """Prove the configured experiment location and SQL warehouse are available."""
    issues: list[str] = []
    client = mlflow_client or mlflow.MlflowClient()
    experiment = None
    try:
        experiment = client.get_experiment(config["MLFLOW_EXPERIMENT_ID"])
    except Exception as error:
        issues.append(
            f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} is unavailable: "
            f"{safe_error_message(error)}"
        )
    if experiment is None:
        issues.append(f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} does not exist")
    else:
        raw_lifecycle = getattr(experiment, "lifecycle_stage", None)
        lifecycle = str(getattr(raw_lifecycle, "value", raw_lifecycle) or "")
        if lifecycle.lower() != "active":
            issues.append(
                f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} is unavailable "
                f"(lifecycle stage: {lifecycle or 'missing'})"
            )
        location = getattr(experiment, "trace_location", None)
        observed = (
            getattr(location, "catalog_name", None),
            getattr(location, "schema_name", None),
            getattr(location, "table_prefix", None),
            getattr(location, "full_otel_spans_table_name", None),
        )
        expected = (
            config["MLFLOW_UC_CATALOG"],
            config["MLFLOW_UC_SCHEMA"],
            config["MLFLOW_UC_TABLE_PREFIX"],
            config["MLFLOW_OTEL_SPANS_TABLE"],
        )
        if observed != expected:
            issues.append(
                f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} has wrong UC trace "
                f"location {observed!r}; expected {expected!r}"
            )

    if workspace_client is None:
        from databricks.sdk import WorkspaceClient

        workspace_client = WorkspaceClient()
    warehouse_id = config["MLFLOW_TRACING_SQL_WAREHOUSE_ID"]
    try:
        warehouse = workspace_client.warehouses.get(warehouse_id)
        raw_state = getattr(warehouse, "state", None)
        state = str(getattr(raw_state, "value", raw_state) or "")
        if state.upper() in {"DELETED", "DELETING"}:
            issues.append(f"SQL warehouse {warehouse_id!r} is unavailable (state: {state})")
    except Exception as error:
        issues.append(f"SQL warehouse {warehouse_id!r} is unavailable: {safe_error_message(error)}")

    if issues:
        raise RuntimeError("Deployment tracing preflight failed: " + "; ".join(issues))


def _redact_text(value: str) -> str:
    return _SECRET_TEXT.sub(
        lambda match: (
            f"{match.group('prefix')}"
            f"{match.group('quote') or ''}[REDACTED]{match.group('quote') or ''}"
        ),
        value,
    )


def _jsonable(value: Any) -> Any:
    try:
        if hasattr(value, "model_dump"):
            return _jsonable(value.model_dump())
        if is_dataclass(value) and not isinstance(value, type):
            return _jsonable(asdict(value))
        if isinstance(value, Mapping):
            return {
                str(key): "[REDACTED]" if _SECRET_KEY.search(str(key)) else _jsonable(item)
                for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
            }
        if isinstance(value, (list, tuple, set, frozenset)):
            return [_jsonable(item) for item in value]
        if isinstance(value, bytes):
            return _jsonable(value.decode("utf-8", errors="replace"))
        if isinstance(value, str):
            if value.lstrip().startswith(("{", "[", "(")):
                for parser in (json.loads, ast.literal_eval):
                    try:
                        return _jsonable(parser(value))
                    except (SyntaxError, TypeError, ValueError):
                        pass
            return _redact_text(value)
        if value is None or isinstance(value, (bool, int, float)):
            return value
        return _redact_text(repr(value))
    except BaseException as error:
        return f"<{type(value).__name__}: {type(error).__name__}>"


def safe_trace_value(value: Any, *, max_bytes: int = _MAX_CAPTURE_BYTES) -> Any:
    """Redact secrets and deterministically bound a captured value."""
    redacted = _jsonable(value)
    encoded = json.dumps(
        redacted, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    if len(encoded) <= max_bytes:
        return redacted
    # Reserve ample space for marker keys, digest, JSON escaping, and exporter limits.
    preview_bytes = encoded[: max_bytes // 2]
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


def safe_error_message(error: BaseException | str) -> str:
    """Return a bounded error message without credential material."""
    safe = safe_trace_value(str(error), max_bytes=2048)
    return safe if isinstance(safe, str) else json.dumps(safe, sort_keys=True)


def _safe_attribute(key: str, value: Any) -> Any:
    if _SECRET_KEY.search(key):
        return "[REDACTED]"
    return safe_trace_value(value, max_bytes=2048)


def current_request_context() -> dict[str, Any] | None:
    """Return mutable identity shared with a concrete MCP tool invocation."""
    return _request_context.get()


@contextmanager
def _safe_span(name: str, span_type: str, attributes: dict[str, Any]) -> Iterator[Any | None]:
    manager = None
    safe_name = safe_error_message(name)
    try:
        safe_attributes = {
            str(key): _safe_attribute(str(key), value) for key, value in attributes.items()
        }
        manager = mlflow.start_span(
            name=safe_name,
            span_type=span_type,
            attributes=safe_attributes,
        )
        span = manager.__enter__()
    except Exception as error:
        logger.error(
            "MLflow span export failed while starting %s: %s",
            safe_name,
            safe_error_message(error),
        )
        yield None
        return
    try:
        yield span
    finally:
        try:
            manager.__exit__(None, None, None)
        except Exception as error:
            logger.error(
                "MLflow span export failed while finishing %s: %s",
                safe_name,
                safe_error_message(error),
            )


def _safe_span_call(span: Any, method: str, *args: Any) -> None:
    try:
        if method in {"set_inputs", "set_outputs"}:
            args = (safe_trace_value(args[0]),)
        elif method == "set_attributes":
            args = ({str(key): _safe_attribute(str(key), value) for key, value in args[0].items()},)
        getattr(span, method)(*args)
    except Exception as error:
        logger.error(
            "MLflow span export failed in %s: %s",
            method,
            safe_error_message(error),
        )


def _failure_message(value: Any) -> str | None:
    """Normalize exceptions and MCP/JSON-RPC failure result shapes."""
    if isinstance(value, BaseException):
        return safe_error_message(value)
    if not isinstance(value, Mapping):
        return None

    error = value.get("error")
    if error:
        if isinstance(error, Mapping):
            for key in ("message", "detail", "text"):
                if error.get(key):
                    return safe_error_message(error[key])
        return safe_error_message(error)

    for key, failed_value in (("ok", False), ("isError", True)):
        if value.get(key) is failed_value:
            for message_key in ("message", "detail", "text"):
                if value.get(message_key):
                    return safe_error_message(value[message_key])
            return f"{key} is {str(failed_value).lower()}"

    for key in ("result", "structuredContent"):
        if key in value:
            if failure := _failure_message(value[key]):
                return failure
    return None


def traced_tool(server_name: str, tool_name: str) -> Callable:
    """Wrap a concrete MCP tool body in a safe semantic TOOL span."""

    def decorate(function: Callable) -> Callable:
        signature = inspect.signature(function)

        @wraps(function)
        def wrapped(*args: Any, **kwargs: Any):
            bound = signature.bind(*args, **kwargs)
            bound.apply_defaults()
            inputs = dict(bound.arguments)
            request = current_request_context() or {}
            attributes = {
                "mcp.server.name": server_name,
                "mcp.tool.name": tool_name,
                "jsonrpc.request.id": request.get("jsonrpc.request.id"),
            }
            started_ns = perf_counter_ns()
            with _safe_span(f"mcp.tool.{tool_name}", "TOOL", attributes) as span:
                if span is not None:
                    _safe_span_call(span, "set_inputs", safe_trace_value(inputs))
                try:
                    result = function(*args, **kwargs)
                except BaseException as error:
                    latency_ms = max(0.0, (perf_counter_ns() - started_ns) / 1_000_000)
                    safe_error = _failure_message(error) or safe_error_message(error)
                    if span is not None:
                        _safe_span_call(span, "set_outputs", {"error": safe_error})
                        _safe_span_call(
                            span,
                            "set_attributes",
                            {
                                "mcp.tool.status": "ERROR",
                                "mcp.tool.error": safe_error,
                                "mcp.tool.latency_ms": latency_ms,
                            },
                        )
                        _safe_span_call(
                            span,
                            "record_exception",
                            RuntimeError(f"{type(error).__name__}: {safe_error}"),
                        )
                        _safe_span_call(span, "set_status", "ERROR")
                    raise

                failure = _failure_message(result)
                status = "ERROR" if failure else "OK"
                latency_ms = max(0.0, (perf_counter_ns() - started_ns) / 1_000_000)
                if span is not None:
                    _safe_span_call(span, "set_outputs", safe_trace_value(result))
                    final_attributes = {
                        "mcp.tool.status": status,
                        "mcp.tool.latency_ms": latency_ms,
                    }
                    if failure:
                        final_attributes["mcp.tool.error"] = failure
                    _safe_span_call(span, "set_attributes", final_attributes)
                    _safe_span_call(span, "set_status", status)
                return result

        return wrapped

    return decorate


def _jsonrpc_identity(body: bytes) -> tuple[str, Any]:
    try:
        payload = json.loads(body)
        if isinstance(payload, dict):
            return str(payload.get("method") or "unknown"), payload.get("id")
    except (TypeError, ValueError):
        pass
    return "unknown", None


def _request_input(body: bytes) -> Any:
    try:
        return json.loads(body)
    except (TypeError, ValueError):
        return body.decode("utf-8", errors="replace")


def _bounded_response_value(value: Any) -> Any:
    """Bound large response leaves while preserving the JSON-RPC envelope."""
    if isinstance(value, Mapping):
        return {str(key): _bounded_response_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_bounded_response_value(item) for item in value]
    if isinstance(value, (str, bytes)):
        return safe_trace_value(value, max_bytes=8 * 1024)
    return _jsonable(value)


def _response_output(body: bytes) -> Any:
    """Parse one SSE JSON envelope, plain JSON, or a bounded raw fallback."""
    text = body.decode("utf-8", errors="replace")
    normalized = text.replace("\r\n", "\n")
    for event in normalized.split("\n\n"):
        data = "\n".join(
            line[5:].lstrip() for line in event.splitlines() if line.startswith("data:")
        )
        if data and data != "[DONE]":
            try:
                return _bounded_response_value(json.loads(data))
            except (TypeError, ValueError):
                break
    try:
        return _bounded_response_value(json.loads(text))
    except (TypeError, ValueError):
        return safe_trace_value(text)


def _finish_request_span(
    span: Any | None,
    *,
    started_ns: int,
    output: Any,
    response_status: int | None,
    failure: str | None,
) -> None:
    if span is None:
        return
    if output is not None:
        _safe_span_call(span, "set_outputs", output)
    status = (
        "ERROR" if failure or (response_status is not None and response_status >= 400) else "OK"
    )
    attributes = {
        "mcp.request.status": status,
        "mcp.request.latency_ms": max(0.0, (perf_counter_ns() - started_ns) / 1_000_000),
    }
    if response_status is not None:
        attributes["http.response.status_code"] = response_status
    if failure:
        attributes["mcp.request.error"] = failure
    elif response_status is not None and response_status >= 400:
        attributes["mcp.request.error"] = f"HTTP {response_status}"
    _safe_span_call(span, "set_attributes", attributes)
    _safe_span_call(span, "set_status", status)


class TraceContextMiddleware:
    """Continue valid W3C context for one complete MCP JSON-RPC request."""

    def __init__(self, app, *, server_name: str):
        self.app = app
        self.server_name = server_name

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path", "").rstrip("/") != "/mcp":
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", ())
        }
        extracted = TraceContextTextMapPropagator().extract(headers)
        span_context = trace.get_current_span(extracted).get_span_context()
        propagation = (
            set_tracing_context_from_http_request_headers(headers)
            if span_context.is_valid
            else nullcontext()
        )

        with propagation:
            started_ns = perf_counter_ns()
            body = bytearray()
            while True:
                message = await receive()
                if message["type"] != "http.request":
                    break
                body.extend(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            method, request_id = _jsonrpc_identity(bytes(body))
            delivered = False

            async def replay_receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()

            shared = {"jsonrpc.request.id": request_id, "jsonrpc.method": method}
            token = _request_context.set(shared)
            try:
                with _safe_span(
                    "mcp.request",
                    "AGENT",
                    {
                        "mcp.server.name": self.server_name,
                        "jsonrpc.method": method,
                        "jsonrpc.request.id": request_id,
                    },
                ) as span:
                    if span is not None:
                        shared["trace_id"] = span.trace_id
                        shared["span_id"] = span.span_id
                        _safe_span_call(span, "set_inputs", _request_input(bytes(body)))

                    response_body = bytearray()
                    response_status = None

                    async def traced_send(message):
                        nonlocal response_status
                        if message["type"] == "http.response.start":
                            response_status = message.get("status")
                            response_headers = list(message.get("headers", ()))
                            if trace_id := shared.get("trace_id"):
                                response_headers.append(
                                    (b"x-mlflow-trace-id", trace_id.encode("ascii"))
                                )
                            if span_id := shared.get("span_id"):
                                response_headers.append(
                                    (b"x-mlflow-span-id", span_id.encode("ascii"))
                                )
                            message = {**message, "headers": response_headers}
                        elif message["type"] == "http.response.body":
                            response_body.extend(message.get("body", b""))
                        await send(message)

                    try:
                        await self.app(scope, replay_receive, traced_send)
                    except BaseException as error:
                        safe_error = _failure_message(error) or safe_error_message(error)
                        _finish_request_span(
                            span,
                            started_ns=started_ns,
                            output={"error": safe_error},
                            response_status=response_status,
                            failure=safe_error,
                        )
                        if span is not None:
                            _safe_span_call(
                                span,
                                "record_exception",
                                RuntimeError(f"{type(error).__name__}: {safe_error}"),
                            )
                        raise
                    output = _response_output(bytes(response_body)) if response_body else None
                    _finish_request_span(
                        span,
                        started_ns=started_ns,
                        output=output,
                        response_status=response_status,
                        failure=_failure_message(output),
                    )
            finally:
                _request_context.reset(token)
