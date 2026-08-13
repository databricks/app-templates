from __future__ import annotations

from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import sys


SOURCE = Path(__file__).parents[1] / "src" / "generate_responses.py"


def load_module():
    spec = importlib.util.spec_from_file_location("support_generate_responses", SOURCE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class CapturedSpan:
    def __init__(self, capture, name, span_type, parent):
        self.capture = capture
        self.name = name
        self.span_type = span_type
        self.parent = parent
        self.inputs = None
        self.outputs = None
        self.attributes = {}
        self.status = None
        self.errors = []

    def set_inputs(self, value):
        self.inputs = value

    def set_outputs(self, value):
        self.outputs = value

    def set_attribute(self, key, value):
        self.attributes[key] = value

    def set_attributes(self, values):
        self.attributes.update(values)

    def set_status(self, status):
        self.status = status

    def record_exception(self, error):
        self.errors.append(str(error))


class SpanManager:
    def __init__(self, capture, span):
        self.capture = capture
        self.span = span

    def __enter__(self):
        self.capture.active.append(self.span)
        return self.span

    def __exit__(self, *_args):
        assert self.capture.active.pop() is self.span


class SpanCapture:
    def __init__(self):
        self.spans = []
        self.active = []
        self.trace_updates = []

    def start_span(self, *, name, span_type):
        span = CapturedSpan(
            self,
            name,
            str(getattr(span_type, "value", span_type)),
            self.active[-1] if self.active else None,
        )
        self.spans.append(span)
        return SpanManager(self, span)


def response(content, *, usage, model="databricks-gpt-5-4-mini"):
    return {
        "model": model,
        "choices": [
            {
                "message": {"content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": usage,
    }


def valid_content(action="credit"):
    return (
        '{"case_summary":"Outage","suggested_response":"Sorry",'
        f'"suggested_action":"{action}","suggested_amount_cents":250,'
        '"reasoning":"Repeat incident"}'
    )


def test_batch_trace_has_per_ticket_children_identity_usage_and_partial_parser_failure(
    monkeypatch,
):
    module = load_module()
    capture = SpanCapture()
    monkeypatch.setattr(module.mlflow, "start_span", capture.start_span)
    monkeypatch.setattr(
        module.mlflow,
        "update_current_trace",
        lambda **kwargs: capture.trace_updates.append(kwargs),
    )

    messages = [
        {
            "message_id": b"one",
            "case_id": b"case-one",
            "case_id_hex": "01",
            "user_id": "user-one",
            "subject": "authorization=Bearer should-not-leak " + "x" * 70_000,
            "status": "open",
        },
        {
            "message_id": b"two",
            "case_id": b"case-two",
            "case_id_hex": "02",
            "user_id": "user-two",
            "subject": "Second ticket",
            "status": "open",
        },
    ]
    model_responses = iter(
        [
            response(
                valid_content(),
                usage={
                    "prompt_tokens": 11,
                    "completion_tokens": 5,
                    "total_tokens": 16,
                    "prompt_tokens_details": {"cached_tokens": 3},
                    "cache_creation_input_tokens": 2,
                    "cost_usd": 0.0042,
                },
            ),
            response(
                "not-json",
                usage={
                    "prompt_tokens": 7,
                    "completion_tokens": 2,
                    "total_tokens": 9,
                },
            ),
        ]
    )

    result = module.process_messages(
        messages,
        prompt_builder=lambda message: f"Ticket: {message['subject']}",
        model_caller=lambda _prompt: next(model_responses),
        generated_at=datetime(2026, 8, 12, tzinfo=timezone.utc),
        identity={
            "session_id": "job-123",
            "user_id": "support-job",
            "request_id": "run-456",
        },
    )

    assert len(result) == 1
    root = capture.spans[0]
    assert root.name == "support.response_generation"
    assert root.span_type == "AGENT"
    children = [span for span in capture.spans if span.parent is root]
    assert [(span.name, span.span_type) for span in children] == [
        ("support.ticket.context", "TOOL"),
        ("support.ticket.model", "CHAT_MODEL"),
        ("support.ticket.parse", "PARSER"),
        ("support.ticket.context", "TOOL"),
        ("support.ticket.model", "CHAT_MODEL"),
        ("support.ticket.parse", "PARSER"),
    ]
    assert root.attributes["mlflow.trace.session"] == "job-123"
    assert root.attributes["mlflow.trace.user"] == "support-job"
    assert root.attributes["appkit.request.id"] == "run-456"
    assert root.attributes["appkit.app.name"] == "agentic-support-console"
    assert root.inputs["truncated"] is True
    assert root.inputs["originalBytes"] > 70_000
    assert len(root.inputs["sha256"]) == 64
    assert "should-not-leak" not in root.inputs["preview"]

    first_model, second_model = [
        span for span in children if span.span_type == "CHAT_MODEL"
    ]
    assert first_model.attributes["appkit.usage"] == {
        "inputTokens": 11,
        "outputTokens": 5,
        "totalTokens": 16,
        "cacheReadInputTokens": 3,
        "cacheCreationInputTokens": 2,
        "costAvailable": True,
        "costUsd": 0.0042,
    }
    assert first_model.attributes["mlflow.chat.tokenUsage"] == {
        "input_tokens": 11,
        "output_tokens": 5,
        "total_tokens": 16,
        "cache_read_input_tokens": 3,
        "cache_creation_input_tokens": 2,
    }
    assert first_model.attributes["appkit.cost_usd"] == 0.0042
    assert second_model.attributes["appkit.cost_available"] is False
    assert "appkit.cost_usd" not in second_model.attributes

    failed_parser = [span for span in children if span.span_type == "PARSER"][1]
    assert failed_parser.status == "ERROR"
    assert failed_parser.outputs["partialOutputs"][0]["suggested_action"] == "credit"
    assert root.status == "ERROR"
    assert root.outputs["partialOutputs"][0]["suggested_action"] == "credit"
    assert root.outputs["errors"][0]["ticketIndex"] == 1
    assert root.attributes["appkit.usage"] == {
        "inputTokens": 18,
        "outputTokens": 7,
        "totalTokens": 25,
        "cacheReadInputTokens": 3,
        "cacheCreationInputTokens": 2,
        "costAvailable": False,
    }
    assert "appkit.cost_usd" not in root.attributes
    assert capture.trace_updates[0]["metadata"]["appkit.request.id"] == "run-456"


def test_runtime_export_failure_does_not_fail_successful_generation(monkeypatch):
    module = load_module()
    monkeypatch.setattr(
        module.mlflow,
        "start_span",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("export unavailable")),
    )
    monkeypatch.setattr(
        module.mlflow,
        "update_current_trace",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("export unavailable")),
    )

    result = module.process_messages(
        [
            {
                "message_id": b"one",
                "case_id": b"case-one",
                "case_id_hex": "01",
                "user_id": "user-one",
                "subject": "Outage",
                "status": "open",
            }
        ],
        prompt_builder=lambda _message: "Ticket context",
        model_caller=lambda _prompt: response(
            valid_content("resolve"),
            usage={"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3},
        ),
        generated_at=datetime(2026, 8, 12, tzinfo=timezone.utc),
        identity={
            "session_id": "job-123",
            "user_id": "support-job",
            "request_id": "run-456",
        },
    )

    assert result[0]["suggested_action"] == "resolve"
