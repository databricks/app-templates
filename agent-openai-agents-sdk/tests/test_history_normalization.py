"""Regression tests for multi-turn assistant-history normalization.

openai-agents >= 0.19 tightened ``Converter.maybe_response_output_message`` to
require ``{"id", "content"}`` on assistant history items. The built-in chat UI
replays the prior assistant turn as an id-less ``{"type": "message",
"role": "assistant", "content": [output_text]}`` item, and MLflow's
``ResponsesAgentRequest`` strips any client-supplied ``id``, so on the second
and later prompts the item failed recognition and hit the catch-all
``UserError: Unhandled item type or structure``.

``normalize_history_items`` collapses those replayed assistant items to the
easy-input ``{"role", "content"}`` form, which is recognized without an id.
These tests lock in that transformation so the regression cannot return silently.
"""

import unittest

from agent_server.history import normalize_history_items


class NormalizeHistoryItemsTest(unittest.TestCase):
    def test_idless_assistant_output_text_collapsed_to_easy_input(self):
        # Exactly what the chat UI replays on the 2nd prompt (no "id").
        messages = [
            {"role": "user", "content": "hello"},
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "Hi! How can I help?"}],
            },
            {"role": "user", "content": "test"},
        ]
        self.assertEqual(
            normalize_history_items(messages),
            [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "Hi! How can I help?"},
                {"role": "user", "content": "test"},
            ],
        )

    def test_multiple_output_text_segments_joined_with_newline(self):
        # Matches the SDK converter, which joins segments with "\n".
        messages = [
            {
                "type": "message",
                "role": "assistant",
                "content": [
                    {"type": "output_text", "text": "part A"},
                    {"type": "output_text", "text": "part B"},
                ],
            }
        ]
        self.assertEqual(
            normalize_history_items(messages),
            [{"role": "assistant", "content": "part A\npart B"}],
        )

    def test_user_and_plain_assistant_items_are_untouched(self):
        messages = [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "already easy-input"},
        ]
        self.assertEqual(normalize_history_items(messages), messages)

    def test_non_output_text_content_parts_are_dropped_from_text(self):
        # Only output_text parts contribute to the collapsed string.
        messages = [
            {
                "type": "message",
                "role": "assistant",
                "content": [
                    {"type": "output_text", "text": "keep"},
                    {"type": "something_else", "foo": "bar"},
                ],
            }
        ]
        self.assertEqual(
            normalize_history_items(messages),
            [{"role": "assistant", "content": "keep"}],
        )

    def test_string_content_assistant_item_collapsed_to_easy_input(self):
        # MLflow evaluation replays the assistant turn with plain-string content;
        # newer converters cast it as a typed output message and then crash
        # iterating the string, so it must also collapse to easy-input form.
        messages = [
            {"type": "message", "role": "assistant", "content": "plain string reply"},
        ]
        self.assertEqual(
            normalize_history_items(messages),
            [{"role": "assistant", "content": "plain string reply"}],
        )

    def test_assistant_item_with_id_is_untouched(self):
        # Items carrying an id are recognized natively by the SDK converter
        # (including refusal parts), so they stay on that path.
        messages = [
            {
                "id": "msg_123",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "typed reply"}],
            }
        ]
        self.assertEqual(normalize_history_items(messages), messages)


if __name__ == "__main__":
    unittest.main()
