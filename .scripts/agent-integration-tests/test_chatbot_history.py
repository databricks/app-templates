"""Unit tests for how the gradio and shiny chatbot templates build the messages
sent to the serving endpoint.

Deploy validation only checks that the page renders, so a broken history
conversion would only surface on the second turn of a real chat. Each test loads
the template's real app.py with the UI framework and model_serving_utils stubbed,
so it runs in the harness venv without gradio or shiny installed.
"""

import importlib.util
import sys
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_app(template: str, ui_modules: list[str], monkeypatch, sent: list):
    utils = mock.MagicMock()
    utils.is_endpoint_supported.return_value = True

    def fake_query(endpoint_name, messages, max_tokens):
        sent.append(messages)
        return {"role": "assistant", "content": "ok"}

    utils.query_endpoint.side_effect = fake_query
    monkeypatch.setitem(sys.modules, "model_serving_utils", utils)
    for name in ui_modules:
        monkeypatch.setitem(sys.modules, name, mock.MagicMock())
    monkeypatch.setenv("SERVING_ENDPOINT", "test-endpoint")
    monkeypatch.setenv("DATABRICKS_APP_DIAGNOSTICS", "0")

    app_dir = REPO_ROOT / template
    monkeypatch.syspath_prepend(str(app_dir))  # for app_diagnostics
    spec = importlib.util.spec_from_file_location(f"{template.replace('-', '_')}_app", app_dir / "app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def gradio_app(monkeypatch):
    sent = []
    module = _load_app("gradio-chatbot-app", ["gradio"], monkeypatch, sent)
    return module, sent


@pytest.fixture
def shiny_app(monkeypatch):
    sent = []
    module = _load_app("shiny-chatbot-app", ["shiny"], monkeypatch, sent)
    return module, sent


def test_gradio_first_turn_sends_only_the_user_message(gradio_app):
    app, sent = gradio_app
    assert app.query_llm("hello", []) == "ok"
    assert sent == [[{"role": "user", "content": "hello"}]]


def test_gradio_history_with_string_and_content_part_messages(gradio_app):
    # gradio 6 passes history as OpenAI-style dicts; content is a string or a
    # list of content parts.
    app, sent = gradio_app
    history = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": [{"type": "text", "text": "yo"}]},
        {"role": "user", "content": [{"type": "text", "text": "how"}, {"type": "text", "text": " are you"}]},
        {"role": "assistant", "content": "fine", "metadata": {"title": None}},
    ]
    app.query_llm("next", history)
    assert sent == [[
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "yo"},
        {"role": "user", "content": "how are you"},
        {"role": "assistant", "content": "fine"},
        {"role": "user", "content": "next"},
    ]]


def test_gradio_skips_non_text_content(gradio_app):
    # A file or component message carries no text the endpoint can use.
    app, sent = gradio_app
    history = [
        {"role": "user", "content": {"path": "/tmp/x.png"}},
        {"role": "user", "content": [{"type": "file", "file": {"path": "/tmp/x.png"}}]},
    ]
    app.query_llm("describe it", history)
    assert sent == [[{"role": "user", "content": "describe it"}]]


def test_gradio_rejects_empty_message(gradio_app):
    app, sent = gradio_app
    assert app.query_llm("   ", []).startswith("ERROR")
    assert sent == []


def test_shiny_keeps_only_role_and_content(shiny_app):
    # shinychat's messages() returns dicts that can carry html_deps/attachments.
    app, _ = shiny_app
    chat_messages = (
        {"role": "user", "content": "hi", "html_deps": [{"name": "x"}]},
        {"role": "assistant", "content": "yo", "attachments": []},
    )
    assert app.to_endpoint_messages(chat_messages) == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "yo"},
    ]


def test_shiny_coerces_content_to_string(shiny_app):
    app, _ = shiny_app
    assert app.to_endpoint_messages([{"role": "user", "content": 42}]) == [
        {"role": "user", "content": "42"},
    ]
