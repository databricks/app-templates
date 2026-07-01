#!/usr/bin/env python3
"""Start the local server and send a smoke-test Responses API request."""

from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib import error, request


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def _wait_for_port(port: int, process: subprocess.Popen, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"server exited early with code {process.returncode}")
        if _port_open(port):
            return
        time.sleep(0.25)
    raise TimeoutError(f"server did not open port {port} within {timeout:.0f}s")


def _post_response(port: int, prompt: str, timeout: float) -> dict:
    payload = json.dumps(
        {"input": [{"role": "user", "content": prompt}]}
    ).encode("utf-8")
    req = request.Request(
        f"http://127.0.0.1:{port}/responses",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer local"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"request failed with HTTP {exc.code}: {body}") from exc


def _print_recent_logs(log_path: Path) -> None:
    if not log_path.exists():
        return
    print(f"\nLast 80 lines of {log_path}:")
    lines = log_path.read_text(errors="replace").splitlines()
    for line in lines[-80:]:
        print(line)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a local server smoke test")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--startup-timeout", type=float, default=90.0)
    parser.add_argument("--request-timeout", type=float, default=120.0)
    parser.add_argument("--prompt", default="What time is it?")
    args = parser.parse_args()

    log_path = Path("preflight-server.log")
    with log_path.open("w", buffering=1) as log_file:
        process = subprocess.Popen(
            ["uv", "run", "start-server", "--port", str(args.port)],
            stdout=log_file,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            _wait_for_port(args.port, process, args.startup_timeout)
            response = _post_response(args.port, args.prompt, args.request_timeout)
            if not response.get("output"):
                raise RuntimeError(f"response did not include output: {response}")
            print("Preflight passed")
            return 0
        except Exception as exc:
            print(f"Preflight failed: {exc}", file=sys.stderr)
            _print_recent_logs(log_path)
            return 1
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
