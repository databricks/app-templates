import os
import shlex
import signal
import socket
import subprocess
import time
from contextlib import closing

import pytest
import requests
from databricks_mcp import DatabricksMCPClient


def _find_free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server_startup(url: str, timeout: int = 10):
    deadline = time.time() + timeout

    while time.time() < deadline:
        try:
            response = requests.get(url, timeout=1)
            if 200 <= response.status_code < 400:
                return response
        except Exception as e:
            last_exc = e
        time.sleep(0.1)
    if last_exc:
        raise last_exc

    raise TimeoutError(f"Server at {url} did not respond in {timeout} seconds")


@pytest.fixture(scope="session")
def run_mcp_server():
    host = "127.0.0.1"
    port = _find_free_port()
    url = f"http://{host}:{port}"
    cmd = shlex.split(f"uv run custom-mcp-server --port {port}")

    # Start the process
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        # Start a new process group so we can kill children on teardown
        preexec_fn=os.setsid,
        creationflags=0,
    )

    try:
        _wait_for_server_startup(url)
    except Exception as e:
        proc.terminate()
        raise e

    yield url

    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=10)
    except Exception:
        os.killpg(proc.pid, signal.SIGKILL)
    finally:
        proc.wait(timeout=5)


# Test List Tools runs without errors
def test_list_tools(run_mcp_server):
    url = run_mcp_server
    mcp_client = DatabricksMCPClient(server_url=f"{url}/mcp")
    tools = mcp_client.list_tools()


# Test Call Tools runs without errors
def test_call_tools(run_mcp_server):
    url = run_mcp_server
    mcp_client = DatabricksMCPClient(server_url=f"{url}/mcp")
    tools = mcp_client.list_tools()
    for tool in tools:
        result = mcp_client.call_tool(tool.name)
        assert result is not None
