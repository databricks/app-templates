"""Minimal Locust load test for a Databricks App agent (streaming /invocations).

Fires two custom metrics per request: `end-to-end` (send -> [DONE]) and `TTFT`
(send -> first answer token). Set LOCUST_AUTORAMP=1 to ramp to saturation.

  locust -f locustfile.py --host https://<app-url>          # web UI at :8089
  LOCUST_AUTORAMP=1 locust -f locustfile.py --host <url> --headless

Auth: set DATABRICKS_HOST + DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET for M2M
OAuth against a deployed app (omit for a local unauthenticated server). Reliability is
validated separately from the server-side MLflow traces — see validate_with_mlflow.py.
"""

import json
import os
import random
import threading
import time

import requests
from locust import HttpUser, LoadTestShape, between, task

PROMPTS = ["What's the weather in Boston?", "What's the stock price of AAPL?"]


class _Token:
    """M2M OAuth token, cached and refreshed ~60s early. Empty header if unset."""

    def __init__(self):
        h = (os.environ.get("DATABRICKS_HOST") or "").strip().rstrip("/")
        # Apps inject DATABRICKS_HOST without a scheme — add it.
        self.host = ("https://" + h) if h and not h.startswith("http") else h
        self.cid = os.environ.get("DATABRICKS_CLIENT_ID")
        self.sec = os.environ.get("DATABRICKS_CLIENT_SECRET")
        self.tok, self.exp, self.lock = None, 0.0, threading.Lock()

    def header(self):
        if not (self.host and self.cid and self.sec):
            return {}
        with self.lock:
            if not self.tok or time.time() > self.exp - 60:
                r = requests.post(f"{self.host}/oidc/v1/token", auth=(self.cid, self.sec),
                                  data={"grant_type": "client_credentials", "scope": "all-apis"},
                                  timeout=30)
                r.raise_for_status()
                b = r.json()
                self.tok = b["access_token"]
                self.exp = time.time() + int(b.get("expires_in", 3600))
        return {"Authorization": f"Bearer {self.tok}"}


_TOK = _Token()


class StreamingUser(HttpUser):
    wait_time = between(0.1, 0.5)

    def on_start(self):
        self._s = requests.Session()

    @task
    def invoke(self):
        body = {"input": [{"role": "user", "content": random.choice(PROMPTS)}], "stream": True}
        start, first, err = time.perf_counter(), None, None
        try:
            with self._s.post(self.host.rstrip("/") + "/invocations", json=body,
                              headers=_TOK.header(), stream=True, timeout=120) as r:
                if r.status_code != 200:
                    err = f"status {r.status_code}: {r.text[:120]}"
                else:
                    done = False
                    for raw in r.iter_lines():
                        if not raw or not raw.startswith(b"data: "):
                            continue
                        payload = raw[len(b"data: "):]
                        if payload == b"[DONE]":
                            done = True
                            break
                        try:
                            evt = json.loads(payload)
                        except ValueError:
                            continue
                        # A 200 stream can still carry an error event (e.g. FM 429).
                        if "error" in evt.get("type", "").lower() or evt.get("error"):
                            err = f"stream error: {str(evt)[:120]}"
                            break
                        if evt.get("type") == "response.output_text.delta" and first is None:
                            first = time.perf_counter()
                    if err is None and not done:
                        err = "stream ended without [DONE]"
        except Exception as e:  # noqa: BLE001
            err = str(e)
        self._fire("POST /invocations (end-to-end)", (time.perf_counter() - start) * 1000, err)
        if err is None and first is not None:
            self._fire("POST /invocations (TTFT)", (first - start) * 1000, None)

    def _fire(self, name, ms, err):
        self.environment.events.request.fire(
            request_type="POST", name=name, response_time=ms, response_length=0,
            exception=Exception(err) if err else None, context={})


# Ramp shape is only registered when requested (a shape that returns None stops the run,
# which would disable the web UI's manual user box).
if os.environ.get("LOCUST_AUTORAMP", "0").lower() in ("1", "true", "yes"):

    class StepRampShape(LoadTestShape):
        max_users = int(os.environ.get("MAX_USERS", "300"))
        step = int(os.environ.get("STEP_SIZE", "20"))
        dur = int(os.environ.get("STEP_DURATION", "30"))

        def tick(self):
            users = (int(self.get_run_time() // self.dur) + 1) * self.step
            return None if users > self.max_users else (users, self.step)
