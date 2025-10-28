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
    connection_name = os.getenv("UC_CONNECTION_NAME")
    spec_volume_path = os.getenv("SPEC_VOLUME_PATH")
    spec_file_name = os.getenv("SPEC_FILE_NAME")
    databricks_profile = os.getenv("DATABRICKS_CONFIG_PROFILE")

    if databricks_profile is None:
        raise ValueError(
            "DATABRICKS_CONFIG_PROFILE environment variable is not set. Please run this test as follows `DATABRICKS_CONFIG_PROFILE=<databricks_profile> UC_CONNECTION_NAME=<connection_name> SPEC_VOLUME_PATH=<spec_volume_path> SPEC_FILE_NAME=<spec_file_name> pytest tests/test_integration_server.py`"
        )

    if connection_name is None:
        raise ValueError(
            "UC_CONNECTION_NAME environment variable is not set. Please run this test as follows `DATABRICKS_CONFIG_PROFILE=<databricks_profile> UC_CONNECTION_NAME=<connection_name> SPEC_VOLUME_PATH=<spec_volume_path> SPEC_FILE_NAME=<spec_file_name> pytest tests/test_integration_server.py`"
        )

    if spec_volume_path is None:
        raise ValueError(
            "SPEC_VOLUME_PATH environment variable is not set. Please run this test as follows `DATABRICKS_CONFIG_PROFILE=<databricks_profile> UC_CONNECTION_NAME=<connection_name> SPEC_VOLUME_PATH=<spec_volume_path> SPEC_FILE_NAME=<spec_file_name> pytest tests/test_integration_server.py`"
        )

    if spec_file_name is None:
        raise ValueError(
            "SPEC_FILE_NAME environment variable is not set. Please run this test as follows `DATABRICKS_CONFIG_PROFILE=<databricks_profile> UC_CONNECTION_NAME=<connection_name> SPEC_VOLUME_PATH=<spec_volume_path> SPEC_FILE_NAME=<spec_file_name> pytest tests/test_integration_server.py`"
        )

    host = "127.0.0.1"
    port = _find_free_port()
    url = f"http://{host}:{port}"
    cmd = shlex.split(f"uv run custom-open-api-spec-server --port {port}")

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
    result = mcp_client.call_tool("list_api_endpoints")
    assert result is not None
