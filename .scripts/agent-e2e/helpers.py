import json
import os
import signal
import subprocess
import time
from pathlib import Path

import requests

from template_config import FileEdit


def clean_template(template_dir: Path):
    """Remove .venv/, uv.lock, .env from template directory."""
    for name in [".venv", "uv.lock", ".env"]:
        target = template_dir / name
        if target.is_dir():
            import shutil

            shutil.rmtree(target)
        elif target.is_file():
            target.unlink()


def run_quickstart(
    template_dir: Path, profile: str, lakebase: str | None = None
):
    """Run `uv run quickstart --profile <profile>`, optionally with --lakebase."""
    cmd = ["uv", "run", "quickstart", "--profile", profile]
    if lakebase:
        cmd.extend(["--lakebase", lakebase])
    result = subprocess.run(
        cmd,
        cwd=template_dir,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, (
        f"quickstart failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def kill_port(port: int):
    """Find and kill any process using the given port."""
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.stdout.strip():
            for pid in result.stdout.strip().split("\n"):
                pid = pid.strip()
                if pid:
                    try:
                        os.kill(int(pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            time.sleep(1)
    except subprocess.TimeoutExpired:
        pass


def start_server(template_dir: Path, port: int = 8000) -> subprocess.Popen:
    """Start `uv run start-server` as background process.

    Waits for 'Uvicorn running on' in stderr (timeout 60s).
    Returns process handle.
    """
    proc = subprocess.Popen(
        ["uv", "run", "start-server", "--port", str(port)],
        cwd=template_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        preexec_fn=os.setsid,
    )

    import select

    deadline = time.time() + 60
    while time.time() < deadline:
        if proc.poll() is not None:
            stdout = proc.stdout.read() if proc.stdout else ""
            stderr = proc.stderr.read() if proc.stderr else ""
            raise RuntimeError(
                f"Server process exited early (code {proc.returncode}):\n"
                f"stdout: {stdout}\nstderr: {stderr}"
            )
        # Check stderr for uvicorn startup message
        ready = select.select([proc.stderr], [], [], 1.0)[0]
        if ready:
            line = proc.stderr.readline()
            if "Uvicorn running on" in line or "Application startup complete" in line:
                return proc
    stop_server(proc)
    raise TimeoutError("Server did not start within 60 seconds")


def stop_server(proc: subprocess.Popen):
    """Kill process group to ensure all children die."""
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


def query_endpoint(base_url: str, payload: dict, endpoint: str = "/responses") -> dict:
    """POST to {base_url}{endpoint}, return response JSON. Timeout: 120s."""
    resp = requests.post(
        f"{base_url}{endpoint}",
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def query_endpoint_with_auth(
    base_url: str, token: str, payload: dict, endpoint: str
) -> dict:
    """POST to {base_url}{endpoint} with Bearer token. Return response JSON."""
    resp = requests.post(
        f"{base_url}{endpoint}",
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def run_evaluate(template_dir: Path):
    """Run `uv run agent-evaluate`. Timeout: 15 minutes."""
    result = subprocess.run(
        ["uv", "run", "agent-evaluate"],
        cwd=template_dir,
        capture_output=True,
        text=True,
        timeout=900,
    )
    assert result.returncode == 0, (
        f"evaluate failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def run_test_agent(template_dir: Path):
    """Run `uv run python test_agent.py` for non-conversational template."""
    result = subprocess.run(
        ["uv", "run", "python", "test_agent.py"],
        cwd=template_dir,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, (
        f"test_agent.py failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def apply_edits(
    edits: list[FileEdit], template_dir: Path
) -> list[tuple[Path, str]]:
    """Apply file edits. Returns list of (path, original_content) for revert."""
    originals: list[tuple[Path, str]] = []
    for edit in edits:
        filepath = template_dir / edit.relative_path
        original = filepath.read_text()
        originals.append((filepath, original))
        assert edit.old in original, (
            f"Could not find expected text in {filepath}:\n"
            f"Looking for: {edit.old[:100]}..."
        )
        filepath.write_text(original.replace(edit.old, edit.new, 1))
    return originals


def revert_edits(originals: list[tuple[Path, str]]):
    """Write back original file contents."""
    for filepath, content in originals:
        filepath.write_text(content)


def apply_lakebase_edit(
    template_dir: Path, lakebase: str
) -> list[tuple[Path, str]]:
    """Replace '<your-lakebase-instance-name>' with lakebase value in databricks.yml."""
    edit = FileEdit(
        relative_path="databricks.yml",
        old="<your-lakebase-instance-name>",
        new=lakebase,
    )
    return apply_edits([edit], template_dir)


# --- Deploy helpers ---


def bundle_deploy(template_dir: Path, profile: str):
    """Run `databricks bundle deploy --target dev -p <profile>`."""
    result = subprocess.run(
        ["databricks", "bundle", "deploy", "--target", "dev", "-p", profile],
        cwd=template_dir,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, (
        f"bundle deploy failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def wait_for_app_ready(app_name: str, profile: str, timeout: int = 600):
    """Poll `databricks apps get` every 30s until RUNNING, then sleep 120s."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = subprocess.run(
            ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            state = data.get("app_status", {}).get("state", "")
            if state == "RUNNING":
                time.sleep(120)
                return
        time.sleep(30)
    raise TimeoutError(f"App {app_name} did not reach RUNNING state within {timeout}s")


def get_app_url(app_name: str, profile: str) -> str:
    """Get URL from `databricks apps get`."""
    result = subprocess.run(
        ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, f"Failed to get app info: {result.stderr}"
    data = json.loads(result.stdout)
    url = data.get("url", "")
    assert url, f"No URL found for app {app_name}"
    return url.rstrip("/")


def get_oauth_token(profile: str) -> str:
    """Get token from `databricks auth token -p <profile>`."""
    result = subprocess.run(
        ["databricks", "auth", "token", "-p", profile],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, f"Failed to get auth token: {result.stderr}"
    data = json.loads(result.stdout)
    token = data.get("access_token", "")
    assert token, "No access_token in auth response"
    return token


def query_deployed_with_openai_sdk(app_url: str, token: str, message: str) -> str:
    """Use OpenAI SDK to test /responses endpoint. Return response.output_text."""
    from openai import OpenAI

    client = OpenAI(
        base_url=f"{app_url}/api/v1",
        api_key=token,
    )
    response = client.responses.create(
        model="agent",
        input=message,
    )
    return response.output_text


def query_deployed_non_conversational(app_url: str, token: str) -> dict:
    """POST to /invocations with dict payload and Bearer token."""
    payload = {
        "document_text": (
            "Total assets: $2,300,000. Total liabilities: $1,200,000. "
            "Shareholder's equity: $1,100,000. Net income: $450,000. "
            "Revenues: $1,700,000. Expenses: $1,250,000."
        ),
        "questions": [
            "Do the documents contain a balance sheet?",
            "Do the documents contain an income statement?",
        ],
    }
    return query_endpoint_with_auth(app_url, token, payload, "/invocations")
