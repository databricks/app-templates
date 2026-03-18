#!/usr/bin/env python3
"""Pre-flight check: start the agent locally, send a test request, verify a response.

Run this before deploying to catch configuration and code errors early.

Usage:
    uv run preflight
"""

import json
import os
import select
import signal
import socket
import subprocess
import sys
import time

# How long to wait for the server to start (seconds)
SERVER_START_TIMEOUT = 120
# How long to wait for a response from the agent (seconds)
REQUEST_TIMEOUT = 120


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def start_server(port: int) -> subprocess.Popen:
    proc = subprocess.Popen(
        ["uv", "run", "start-server", "--port", str(port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        preexec_fn=os.setsid,
    )

    deadline = time.time() + SERVER_START_TIMEOUT
    while time.time() < deadline:
        if proc.poll() is not None:
            stderr = proc.stderr.read() if proc.stderr else ""
            print(f"  Server exited early (code {proc.returncode})")
            if stderr:
                # Print last 20 lines of stderr for debugging
                lines = stderr.strip().splitlines()
                for line in lines[-20:]:
                    print(f"    {line}")
            sys.exit(1)

        ready = select.select([proc.stderr], [], [], 1.0)[0]
        if ready:
            line = proc.stderr.readline()
            if "Uvicorn running on" in line or "Application startup complete" in line:
                return proc

    stop_server(proc)
    print(f"  Server did not start within {SERVER_START_TIMEOUT}s")
    sys.exit(1)


def stop_server(proc: subprocess.Popen):
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass


def check_health(base_url: str) -> bool:
    import urllib.request
    import urllib.error

    try:
        req = urllib.request.Request(f"{base_url}/health")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("status") == "healthy"
    except Exception as e:
        print(f"  Health check failed: {e}")
        return False


def check_invocations(base_url: str) -> bool:
    import urllib.request
    import urllib.error

    payload = json.dumps(
        {"input": [{"role": "user", "content": "Say hello in one word."}]}
    ).encode()

    try:
        req = urllib.request.Request(
            f"{base_url}/invocations",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read())
            # Check that we got a response with output
            if "output" in data and len(data["output"]) > 0:
                return True
            print(f"  Unexpected response shape: {json.dumps(data)[:200]}")
            return False
    except Exception as e:
        print(f"  Invocations request failed: {e}")
        return False


def main():
    print("Pre-flight check")
    print("=" * 40)

    port = find_free_port()
    base_url = f"http://localhost:{port}"

    # Step 1: Start server
    print(f"1. Starting server on port {port}...")
    proc = start_server(port)
    print("   OK")

    try:
        # Step 2: Health check
        print("2. Health check...")
        if not check_health(base_url):
            print("   FAILED")
            sys.exit(1)
        print("   OK")

        # Step 3: Send a test request
        print("3. Sending test request to /invocations...")
        if not check_invocations(base_url):
            print("   FAILED")
            sys.exit(1)
        print("   OK")

        print("=" * 40)
        print("Pre-flight check passed!")

    finally:
        stop_server(proc)


if __name__ == "__main__":
    main()
