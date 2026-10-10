"""
Locust load test for Databricks Apps agent endpoints — Ramp-to-Saturation.

Uses LoadTestShape to step up users every STEP_DURATION seconds until MAX_USERS.
Sends streaming requests to /invocations and tracks TTFT + total time.

Auth (in priority order):
    1. M2M OAuth (recommended for long/overnight runs):
       Set DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET.
       Tokens are refreshed automatically — no human interaction needed.

    2. Static token:
       Set DATABRICKS_TOKEN env var. Will NOT auto-refresh — may expire
       during long load tests.

    3. Databricks CLI (U2M):
       Set DATABRICKS_HOST (or DATABRICKS_PROFILE). Uses `databricks auth token`.
       May expire during long runs if refresh token expires.

Usage:
    # Via the wrapper script (recommended):
    python run_load_test.py --app-url https://your-app-url \\
        --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET>

    # Direct locust usage with M2M OAuth:
    export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
    export DATABRICKS_CLIENT_ID=<CLIENT_ID>
    export DATABRICKS_CLIENT_SECRET=<CLIENT_SECRET>
    locust -f locustfile.py --host https://your-app-url --headless --html report.html

    # Custom ramp parameters:
    STEP_SIZE=20 STEP_DURATION=45 MAX_USERS=500 locust -f locustfile.py ...
"""

import json
import os
import subprocess
import threading
import time

import requests as http_requests

from locust import HttpUser, LoadTestShape, events, task


class TokenManager:
    """Thread-safe token manager with M2M OAuth support.

    Auth methods (checked in order):
        1. M2M OAuth: DATABRICKS_HOST + DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET
           → calls /oidc/v1/token with client_credentials grant, auto-refreshes
        2. Static token: DATABRICKS_TOKEN env var (no refresh)
        3. CLI fallback: `databricks auth token` (may require browser for U2M)
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._token = None
                    cls._instance._expires_at = 0
                    cls._instance._refresh_lock = threading.Lock()
        return cls._instance

    def get_token(self) -> str:
        # 1. M2M OAuth — preferred for long-running load tests
        client_id = os.environ.get("DATABRICKS_CLIENT_ID")
        client_secret = os.environ.get("DATABRICKS_CLIENT_SECRET")
        host = os.environ.get("DATABRICKS_HOST", "").rstrip("/")

        if client_id and client_secret and host:
            if time.time() < self._expires_at - 60:
                return self._token
            with self._refresh_lock:
                if time.time() < self._expires_at - 60:
                    return self._token
                return self._refresh_m2m(host, client_id, client_secret)

        # 2. Static token
        env_token = os.environ.get("DATABRICKS_TOKEN")
        if env_token:
            return env_token

        # 3. CLI fallback
        if time.time() < self._expires_at - 60:
            return self._token

        with self._refresh_lock:
            if time.time() < self._expires_at - 60:
                return self._token
            return self._refresh_via_cli()

    def _refresh_m2m(self, host: str, client_id: str, client_secret: str) -> str:
        """Exchange client credentials for an access token via M2M OAuth."""
        resp = http_requests.post(
            f"{host}/oidc/v1/token",
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": "all-apis",
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._expires_at = time.time() + data.get("expires_in", 3600)
        return self._token

    def _refresh_via_cli(self) -> str:
        host = os.environ.get("DATABRICKS_HOST", "")
        cmd = ["databricks", "auth", "token"]
        if host:
            cmd += ["--host", host]
        else:
            profile = os.environ.get("DATABRICKS_PROFILE", "DEFAULT")
            cmd += ["--profile", profile]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
        )
        data = json.loads(result.stdout)
        self._token = data["access_token"]
        self._expires_at = time.time() + data.get("expires_in", 3600)
        return self._token


token_manager = TokenManager()


class StepRampShape(LoadTestShape):
    """
    Step up users every step_duration seconds.
    Stops when max_users is reached. QPS plateau indicates saturation.

    Configure via env vars:
        STEP_SIZE: users added per step (default: 20)
        STEP_DURATION: seconds per step (default: 60)
        MAX_USERS: upper bound (default: 300)
        SPAWN_RATE: users/sec during ramp (default: 10)
    """

    def __init__(self):
        super().__init__()
        self.step_size = int(os.environ.get("STEP_SIZE", "20"))
        self.step_duration = int(os.environ.get("STEP_DURATION", "60"))
        self.max_users = int(os.environ.get("MAX_USERS", "300"))
        self.spawn_rate = int(os.environ.get("SPAWN_RATE", "10"))

    def tick(self):
        run_time = self.get_run_time()
        step = int(run_time // self.step_duration)
        users = (step + 1) * self.step_size
        if users > self.max_users:
            return None  # stop test
        return (users, self.spawn_rate)


class AgentUser(HttpUser):
    # No wait_time — we want max throughput per user
    # Each user sends a request, waits for response, immediately sends next
    wait_time = lambda self: 0

    @task
    def stream_invocation(self):
        headers = {
            "Authorization": f"Bearer {token_manager.get_token()}",
            "Content-Type": "application/json",
        }
        payload = {
            "input": [
                {
                    "role": "user",
                    "content": "What time is it right now, and what time will it be 2 hours and 32 minutes from now?",
                }
            ],
            "stream": True,
        }

        start_time = time.perf_counter()
        ttft = None
        chunk_count = 0
        done = False

        with self.client.post(
            "/invocations",
            json=payload,
            headers=headers,
            stream=True,
            catch_response=True,
            name="/invocations (stream)",
        ) as response:
            if response.status_code != 200:
                response.failure(
                    f"HTTP {response.status_code}: {response.text[:200]}"
                )
                return

            try:
                for line in response.iter_lines(decode_unicode=True):
                    if not line:
                        continue

                    if line.startswith("data: "):
                        data_str = line[6:].strip()

                        if data_str == "[DONE]":
                            done = True
                            break

                        if ttft is None:
                            ttft = (time.perf_counter() - start_time) * 1000

                        try:
                            event = json.loads(data_str)
                            if event.get("type") == "response.output_text.delta":
                                chunk_count += 1
                        except json.JSONDecodeError:
                            pass

                total_time = (time.perf_counter() - start_time) * 1000

                if not done:
                    response.failure("Stream ended without [DONE]")
                elif chunk_count == 0:
                    response.failure("No text delta chunks received")
                else:
                    response.success()

                # Fire custom TTFT metric
                if ttft is not None:
                    events.request.fire(
                        request_type="CUSTOM",
                        name="TTFT",
                        response_time=ttft,
                        response_length=0,
                        exception=None,
                        context={},
                    )

            except Exception as e:
                response.failure(f"Stream error: {e}")
