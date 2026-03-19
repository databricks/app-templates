#!/usr/bin/env python3
"""Pre-flight check: start the agent locally, send a test request, verify a response.

Run this before deploying to catch configuration and code errors early.

Usage:
    uv run preflight
"""

import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

_IS_WINDOWS = sys.platform == "win32"

# How long to wait for the server to start (seconds)
SERVER_START_TIMEOUT = 60
# How long to wait for a response from the agent (seconds)
REQUEST_TIMEOUT = 60


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def start_server(port: int) -> subprocess.Popen:
    popen_kwargs = {}
    if _IS_WINDOWS:
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_kwargs["preexec_fn"] = os.setsid

    proc = subprocess.Popen(
        ["uv", "run", "start-server", "--port", str(port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        **popen_kwargs,
    )

    lines_queue: list[str] = []
    def _reader():
        for line in iter(proc.stderr.readline, ""):
            lines_queue.append(line)

    t = threading.Thread(target=_reader, daemon=True)
    t.start()

    deadline = time.time() + SERVER_START_TIMEOUT
    while time.time() < deadline:
        if proc.poll() is not None:
            t.join(timeout=2)
            stderr = "".join(lines_queue)
            print(f"  Server exited early (code {proc.returncode})")
            if stderr:
                for line in stderr.strip().splitlines()[-20:]:
                    print(f"    {line}")
            sys.exit(1)

        while lines_queue:
            line = lines_queue.pop(0)
            if "Uvicorn running on" in line or "Application startup complete" in line:
                return proc

        time.sleep(0.5)

    stop_server(proc)
    print(f"  Server did not start within {SERVER_START_TIMEOUT}s")
    sys.exit(1)


def stop_server(proc: subprocess.Popen):
    if _IS_WINDOWS:
        proc.terminate()
    else:
        import signal

        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def check_health(base_url: str) -> bool:
    try:
        req = urllib.request.Request(f"{base_url}/health")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("status") == "healthy"
    except Exception as e:
        print(f"  Health check failed: {e}")
        return False


def check_invocations(base_url: str, retries: int = 2) -> bool:
    payload = json.dumps(
        {"input": [{"role": "user", "content": "Say hello in one word."}]}
    ).encode()

    for attempt in range(retries + 1):
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
            if attempt < retries:
                print(f"   Attempt {attempt + 1} failed ({e}), retrying...")
                time.sleep(3)
            else:
                print(f"  Invocations request failed: {e}")
                return False
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
