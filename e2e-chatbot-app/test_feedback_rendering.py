"""Regression test for the first-message feedback widget (issue #42).

The feedback widget is attached by ``AssistantResponse.render()`` when the chat
history is drawn at the top of the script. Because a new response is appended
*after* that loop, the app must ``st.rerun()`` so the freshly added response is
re-rendered through the history loop with feedback attached — otherwise the
feedback control is missing on the first message until the next request.

This test sends a single message and asserts the feedback widget is present.
"""

import os
from unittest.mock import patch

from streamlit.testing.v1 import AppTest

os.environ["SERVING_ENDPOINT"] = "test-endpoint"


def _fake_stream(endpoint_name, messages, return_traces):
    """Mimic a chat/completions stream that carries a request id (needed for
    feedback to render)."""
    yield {"choices": [{"delta": {"content": "Hello there!"}}]}
    yield {"databricks_output": {"databricks_request_id": "req-abc-123"}}


def _has_feedback_widget(at) -> bool:
    """Walk the element tree for the feedback widget, which Streamlit renders as
    a ButtonGroup keyed ``feedback_<idx>``."""
    found = False

    def visit(node):
        nonlocal found
        key = getattr(node, "key", None)
        if key is not None and str(key).startswith("feedback_"):
            found = True
        kids = getattr(node, "children", None)
        if isinstance(kids, dict):
            for child in kids.values():
                visit(child)

    visit(at._tree)
    return found


def test_feedback_shown_on_first_message():
    with (
        patch("model_serving_utils.endpoint_supports_feedback", return_value=True),
        patch(
            "model_serving_utils._get_endpoint_task_type",
            return_value="chat/completions",
        ),
        patch(
            "model_serving_utils.query_endpoint_stream",
            side_effect=_fake_stream,
        ),
    ):
        at = AppTest.from_file("app.py", default_timeout=30)
        at.run()
        at.chat_input[0].set_value("hi").run()

        assert len(at.exception) == 0, list(at.exception)
        assert _has_feedback_widget(at), (
            "feedback widget missing on first assistant message"
        )
