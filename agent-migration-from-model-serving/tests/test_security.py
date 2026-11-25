"""The middleware stack from ``start_server.py`` must not block legitimate requests.

Scripts, SDKs and other services call ``/invocations`` without an ``Origin`` header;
only browsers send one. These tests check that such a request still reaches the agent,
while a request sent from another site's page is refused. Clients also resend the whole
conversation on every request, so a long thread must keep reaching the agent too.
"""

import asyncio
import json
import os
import unittest
from unittest import mock

from agent_server.security import (
    MAX_BODY_BYTES,
    RequestValidationMiddleware,
    SecurityMiddleware,
)
from agent_server.utils import check_request_limits

APP_URL = "https://my-agent-1234567890.aws.databricksapps.com"
BODY = {"input": [{"role": "user", "content": "What is 2+2?"}]}


def post_invocations(origin=None, body=BODY, validate=lambda body: None):
    """Send POST /invocations through the middleware; return (status, bodies the agent got)."""
    received = []

    async def agent(scope, receive, send):
        received.append(json.loads((await receive())["body"]))
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    app = SecurityMiddleware(RequestValidationMiddleware(agent, validate=validate))
    raw = json.dumps(body).encode()
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(raw)).encode()),
    ]
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/invocations",
        "headers": headers,
    }
    sent = []

    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    return sent[0]["status"], received


@mock.patch.dict(os.environ, {"DATABRICKS_APP_URL": APP_URL, "ALLOWED_ORIGINS": ""})
class InvocationsOriginTest(unittest.TestCase):
    def test_request_without_origin_reaches_agent(self):
        self.assertEqual(post_invocations(), (200, [BODY]))

    def test_request_from_app_origin_reaches_agent(self):
        self.assertEqual(post_invocations(APP_URL), (200, [BODY]))

    def test_request_from_other_site_is_refused(self):
        self.assertEqual(post_invocations("https://evil.example"), (403, []))

    def test_request_with_null_origin_is_refused(self):
        self.assertEqual(post_invocations("null"), (403, []))


@mock.patch.dict(os.environ, {"DATABRICKS_APP_URL": APP_URL, "ALLOWED_ORIGINS": ""})
class InvocationsSizeTest(unittest.TestCase):
    def test_long_chat_with_large_tool_output_reaches_agent(self):
        items = []
        for i in range(5_000):
            items += [
                {"role": "user", "content": f"question {i}"},
                {
                    "type": "function_call",
                    "call_id": f"call_{i}",
                    "name": "lookup",
                    "arguments": "{}",
                },
                {
                    "type": "function_call_output",
                    "call_id": f"call_{i}",
                    "output": "result",
                },
            ]
        items[2]["output"] = "x" * 1_000_000
        body = {"input": items}
        self.assertEqual(
            post_invocations(body=body, validate=check_request_limits), (200, [body])
        )

    def test_chat_with_large_images_reaches_agent(self):
        image = {
            "type": "input_image",
            "image_url": "data:image/png;base64," + "A" * 8_000_000,
        }
        content = [{"type": "input_text", "text": "Compare these."}] + [image] * 3
        body = {"input": [{"role": "user", "content": content}]}
        self.assertEqual(
            post_invocations(body=body, validate=check_request_limits), (200, [body])
        )

    def test_body_over_size_limit_is_refused(self):
        body = {"input": [{"role": "user", "content": "x" * MAX_BODY_BYTES}]}
        self.assertEqual(post_invocations(body=body), (413, []))

    def test_body_with_too_many_values_is_refused_before_validation(self):
        validated = []
        status, received = post_invocations(
            body={"input": [{}] * 300_000}, validate=validated.append
        )
        self.assertEqual((status, received, validated), (400, [], []))


if __name__ == "__main__":
    unittest.main()
