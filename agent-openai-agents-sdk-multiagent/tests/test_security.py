"""The CSRF check in ``SecurityMiddleware`` must not block API clients.

Scripts, SDKs and other services call ``/invocations`` without an ``Origin`` header;
only browsers send one. These tests run the middleware stack from ``start_server.py``
and check that such a request still reaches the agent, while a request sent from
another site's page is refused.
"""

import asyncio
import json
import os
import unittest
from unittest import mock

from agent_server.security import RequestValidationMiddleware, SecurityMiddleware

APP_URL = "https://my-agent-1234567890.aws.databricksapps.com"
BODY = {"input": [{"role": "user", "content": "What is 2+2?"}]}


def post_invocations(origin=None):
    """Send POST /invocations through the middleware; return (status, bodies the agent got)."""
    received = []

    async def agent(scope, receive, send):
        received.append(json.loads((await receive())["body"]))
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    app = SecurityMiddleware(RequestValidationMiddleware(agent, validate=lambda body: None))
    body = json.dumps(BODY).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    scope = {"type": "http", "method": "POST", "path": "/invocations", "headers": headers}
    sent = []

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

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


if __name__ == "__main__":
    unittest.main()
