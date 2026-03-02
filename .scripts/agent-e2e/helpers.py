import json
import os
import select
import shutil
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path

import requests
from databricks_ai_bridge.lakebase import (
    LakebaseClient,
    SchemaPrivilege,
    SequencePrivilege,
    TablePrivilege,
)
from template_config import FileEdit

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
POLL_INTERVAL = 30  # seconds between polls
MAX_POLLS = 10  # max number of polls before giving up
QUERY_TIMEOUT = 120  # seconds for HTTP requests
BUNDLE_TIMEOUT = 300  # seconds for bundle deploy/run/destroy commands
QUICKSTART_TIMEOUT = 300  # seconds for quickstart command
EVALUATE_TIMEOUT = 900  # seconds for agent-evaluate
SERVER_START_TIMEOUT = 60  # seconds to wait for local server to start

# ---------------------------------------------------------------------------
# Thread-safe logging
# ---------------------------------------------------------------------------
_thread_local = threading.local()
_log_lock = threading.Lock()


def set_log_file(log_file: Path | None):
    """Set the log file for the current thread."""
    _thread_local.log_file = log_file


def _log(msg: str):
    """Write to the current thread's log file and stdout."""
    print(msg)
    log_file = getattr(_thread_local, "log_file", None)
    if log_file:
        with _log_lock, open(log_file, "a") as f:
            f.write(msg + "\n")


def _run_cmd(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run a subprocess, log its output, and return the result."""
    kwargs.setdefault("capture_output", True)
    kwargs.setdefault("text", True)
    _log(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd, **kwargs)
    _log(f"  exit={result.returncode}")
    if result.stdout:
        _log(f"  stdout:\n{result.stdout.rstrip()}")
    if result.stderr:
        _log(f"  stderr:\n{result.stderr.rstrip()}")
    return result


# ---------------------------------------------------------------------------
# Parse helpers
# ---------------------------------------------------------------------------


def _parse_yml_names(template_dir: Path) -> tuple[str, str] | None:
    """Parse bundle_name and app_name from databricks.yml. Returns None on failure."""
    import re

    yml_path = template_dir / "databricks.yml"
    if not yml_path.exists():
        return None
    text = yml_path.read_text()
    bundle_match = re.search(r"^bundle:\s*\n\s*name:\s*(\S+)", text, re.MULTILINE)
    app_match = re.search(r'^\s*apps:\s*\n\s*\w+:\s*\n\s*name:\s*"([^"]+)"', text, re.MULTILINE)
    if not bundle_match or not app_match:
        return None
    return bundle_match.group(1), app_match.group(1)


# ---------------------------------------------------------------------------
# Clean helpers
# ---------------------------------------------------------------------------


def _clean_bundle_state(template_dir: Path, profile: str):
    """Delete local .bundle/, .databricks/bundle/, and remote workspace terraform state."""
    for name in [".bundle", ".databricks/bundle"]:
        d = template_dir / name
        if d.is_dir():
            shutil.rmtree(d)

    names = _parse_yml_names(template_dir)
    if not names:
        return
    bundle_name = names[0]

    user_result = _run_cmd(
        ["databricks", "current-user", "me", "-p", profile, "--output", "json"],
        timeout=30,
    )
    if user_result.returncode == 0:
        user_name = json.loads(user_result.stdout).get("userName", "")
        if user_name:
            remote_path = f"/Workspace/Users/{user_name}/.bundle/{bundle_name}"
            _run_cmd(
                ["databricks", "workspace", "delete", remote_path, "--recursive", "-p", profile],
                timeout=30,
            )


def _delete_existing_app(template_dir: Path, profile: str):
    """Delete the Databricks app named in databricks.yml and wait until it's gone."""
    names = _parse_yml_names(template_dir)
    if not names:
        return
    app_name = names[1]
    result = _run_cmd(
        ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
        timeout=30,
    )
    if result.returncode != 0:
        return  # App doesn't exist

    # Try to delete (may fail if already deleting)
    _run_cmd(
        ["databricks", "apps", "delete", app_name, "-p", profile],
        timeout=60,
    )

    # Poll until the app is fully gone
    _log(f"Waiting for app '{app_name}' to be fully deleted...")
    for _ in range(MAX_POLLS):
        time.sleep(POLL_INTERVAL)
        result = _run_cmd(
            ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
            timeout=30,
        )
        if result.returncode != 0:
            _log(f"App '{app_name}' fully deleted.")
            return

    _log(f"WARNING: App '{app_name}' still exists after {MAX_POLLS} polls.")


def clean_template(template_dir: Path, profile: str = "dev"):
    """Remove .venv/, uv.lock, .env, .bundle, .databricks/bundle, remote state, and existing apps."""
    for name in [".venv", "uv.lock", ".env", ".bundle", ".databricks/bundle"]:
        target = template_dir / name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.is_file():
            target.unlink()

    _clean_bundle_state(template_dir, profile)
    _delete_existing_app(template_dir, profile)


# ---------------------------------------------------------------------------
# Quickstart / server
# ---------------------------------------------------------------------------


def run_quickstart(template_dir: Path, profile: str, lakebase: str | None = None):
    """Run `uv run quickstart --profile <profile>`, optionally with --lakebase."""
    cmd = ["uv", "run", "quickstart", "--profile", profile]
    if lakebase:
        cmd.extend(["--lakebase", lakebase])
    result = _run_cmd(cmd, cwd=template_dir, timeout=QUICKSTART_TIMEOUT)
    assert result.returncode == 0, (
        f"quickstart failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def find_free_port() -> int:
    """Bind to port 0 and return the OS-assigned free port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def start_server(template_dir: Path, port: int = 0) -> tuple[subprocess.Popen, int]:
    """Start `uv run start-server` as background process.

    If port is 0 (default), dynamically allocates a free port.
    Waits for 'Uvicorn running on' in stderr (timeout 60s).
    Returns (process handle, port).
    """
    if port == 0:
        port = find_free_port()

    _log(f"Starting server on port {port} in {template_dir.name}")
    proc = subprocess.Popen(
        ["uv", "run", "start-server", "--port", str(port)],
        cwd=template_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        preexec_fn=os.setsid,
    )

    deadline = time.time() + SERVER_START_TIMEOUT
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
                _log(f"Server started on port {port}")
                return proc, port
    stop_server(proc)
    raise TimeoutError(f"Server did not start within {SERVER_START_TIMEOUT} seconds")


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


# ---------------------------------------------------------------------------
# Endpoint query helpers
# ---------------------------------------------------------------------------


def query_endpoint(
    base_url: str,
    payload: dict,
    endpoint: str = "/responses",
    extra_headers: dict[str, str] | None = None,
) -> dict:
    """POST to {base_url}{endpoint}, return response JSON. Timeout: 120s."""
    url = f"{base_url}{endpoint}"
    _log(f"POST {url}")
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    resp = requests.post(
        url,
        json=payload,
        headers=headers,
        timeout=QUERY_TIMEOUT,
    )
    _log(f"  status={resp.status_code}")
    if not resp.ok:
        body = resp.text[:2000]
        _log(f"  error body: {body}")
        raise requests.HTTPError(
            f"{resp.status_code} for {resp.url}\nResponse body: {body}",
            response=resp,
        )
    _log(f"  response: {json.dumps(resp.json(), indent=2)[:1000]}")
    return resp.json()


def _assert_sse_stream(
    base_url: str,
    payload: dict,
    endpoint: str,
    extra_headers: dict[str, str] | None = None,
) -> None:
    """POST with stream=True and validate the SSE response contains data."""
    url = f"{base_url}{endpoint}"
    _log(f"POST {url} (streaming)")
    stream_payload = {**payload, "stream": True}
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    resp = requests.post(
        url,
        json=stream_payload,
        headers=headers,
        timeout=QUERY_TIMEOUT,
        stream=True,
    )
    resp.raise_for_status()
    content_type = resp.headers.get("content-type", "")
    assert "text/event-stream" in content_type, f"Expected text/event-stream, got {content_type}"
    has_data = any(
        line.startswith("data:") for line in resp.iter_lines(decode_unicode=True) if line
    )
    _log(f"  streaming: content_type={content_type}, has_data={has_data}")
    assert has_data, "No SSE data: events received in stream response"


def query_endpoint_stream(
    base_url: str,
    payload: dict,
    endpoint: str = "/responses",
    extra_headers: dict[str, str] | None = None,
) -> None:
    """POST with stream=True, validate SSE response with at least one data: event."""
    _assert_sse_stream(base_url, payload, endpoint, extra_headers)


# ---------------------------------------------------------------------------
# Evaluate / test
# ---------------------------------------------------------------------------


def run_evaluate(template_dir: Path):
    """Run `uv run agent-evaluate`. Timeout: 15 minutes."""
    result = _run_cmd(
        ["uv", "run", "agent-evaluate"],
        cwd=template_dir,
        timeout=EVALUATE_TIMEOUT,
    )
    assert result.returncode == 0, (
        f"evaluate failed in {template_dir.name}:\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )


def run_test_agent(template_dir: Path):
    """Run `uv run python test_agent.py` for non-conversational template."""
    result = _run_cmd(
        ["uv", "run", "python", "test_agent.py"],
        cwd=template_dir,
        timeout=QUERY_TIMEOUT,
    )
    assert result.returncode == 0, (
        f"test_agent.py failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


# ---------------------------------------------------------------------------
# File edits
# ---------------------------------------------------------------------------


def apply_edits(edits: list[FileEdit], template_dir: Path) -> list[tuple[Path, str]]:
    """Apply file edits. Returns list of (path, original_content) for revert.

    Only the *first* snapshot of each file is stored so that files with multiple
    edits (e.g. multiagent's 3 edits to databricks.yml) are reverted to the true
    original content.
    """
    seen: dict[Path, str] = {}
    for edit in edits:
        filepath = template_dir / edit.relative_path
        current = filepath.read_text()
        if filepath not in seen:
            seen[filepath] = current
        assert edit.old in current, (
            f"Could not find expected text in {filepath}:\nLooking for: {edit.old[:100]}..."
        )
        filepath.write_text(current.replace(edit.old, edit.new, 1))
        _log(f"Applied edit to {edit.relative_path}")
    return list(seen.items())


def revert_edits(originals: list[tuple[Path, str]]):
    """Write back original file contents."""
    for filepath, content in originals:
        filepath.write_text(content)


# ---------------------------------------------------------------------------
# Deploy helpers
# ---------------------------------------------------------------------------


def bundle_deploy(template_dir: Path, profile: str):
    """Run `databricks bundle deploy --target dev -p <profile>`.

    Handles transient errors with automatic recovery:
    - Terraform init failures (e.g. GitHub 502): wait and retry
    - "already exists": delete existing app + clean state, retry
    - "does not exist or is deleted": clean stale state, wait and retry
    """
    for attempt in range(1, MAX_POLLS + 1):
        result = _run_cmd(
            ["databricks", "bundle", "deploy", "--target", "dev", "-p", profile],
            cwd=template_dir,
            timeout=BUNDLE_TIMEOUT,
        )
        if result.returncode == 0:
            return

        stderr = result.stderr
        if attempt < MAX_POLLS:
            if "terraform init" in stderr:
                _log(
                    f"bundle deploy attempt {attempt}/{MAX_POLLS} failed in "
                    f"{template_dir.name} (terraform init error), retrying in {POLL_INTERVAL}s..."
                )
                time.sleep(POLL_INTERVAL)
                continue

            if "already exists" in stderr:
                _log(
                    f"bundle deploy attempt {attempt}/{MAX_POLLS} failed in "
                    f"{template_dir.name} (app already exists), cleaning up..."
                )
                _delete_existing_app(template_dir, profile)
                _clean_bundle_state(template_dir, profile)
                continue

            if "does not exist or is deleted" in stderr:
                _log(
                    f"bundle deploy attempt {attempt}/{MAX_POLLS} failed in "
                    f"{template_dir.name} (stale state), cleaning up and retrying in {POLL_INTERVAL}s..."
                )
                _clean_bundle_state(template_dir, profile)
                time.sleep(POLL_INTERVAL)
                continue

        break
    assert result.returncode == 0, (
        f"bundle deploy failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def bundle_run(template_dir: Path, resource_key: str, profile: str):
    """Run `databricks bundle run <resource_key> --target dev` to start the app."""
    _log(f"Starting app via bundle run {resource_key}...")
    for attempt in range(1, MAX_POLLS + 1):
        result = _run_cmd(
            ["databricks", "bundle", "run", resource_key, "--target", "dev", "-p", profile],
            cwd=template_dir,
            timeout=BUNDLE_TIMEOUT,
        )
        if result.returncode == 0:
            return
        if attempt < MAX_POLLS:
            _log(
                f"bundle run attempt {attempt}/{MAX_POLLS} failed in "
                f"{template_dir.name}, retrying in {POLL_INTERVAL}s..."
            )
            time.sleep(POLL_INTERVAL)
    assert result.returncode == 0, (
        f"bundle run failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def bundle_destroy(template_dir: Path, profile: str):
    """Run `databricks bundle destroy --target dev` to clean up deployed resources.

    Best-effort: prints warnings on failure, never raises.
    """
    try:
        result = _run_cmd(
            [
                "databricks",
                "bundle",
                "destroy",
                "--target",
                "dev",
                "-p",
                profile,
                "--auto-approve",
            ],
            cwd=template_dir,
            timeout=BUNDLE_TIMEOUT,
        )
        if result.returncode != 0:
            _log(
                f"WARNING: bundle destroy failed in {template_dir.name}:\n"
                f"stdout: {result.stdout}\nstderr: {result.stderr}"
            )
    except Exception as exc:
        _log(f"WARNING: bundle destroy errored in {template_dir.name}: {exc}")


def wait_for_app_ready(app_name: str, profile: str) -> str:
    """Poll `databricks apps get` until RUNNING, then poll /agent/info until responsive.

    Returns the app URL (without trailing slash).
    """
    # Phase 1: wait for RUNNING state
    _log(f"Waiting for app {app_name} to reach RUNNING state...")
    app_url = ""
    for _ in range(MAX_POLLS):
        result = _run_cmd(
            ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
            timeout=60,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            state = data.get("app_status", {}).get("state", "")
            _log(f"  app state: {state}")
            if state == "RUNNING":
                app_url = data.get("url", "").rstrip("/")
                assert app_url, f"No URL found for app {app_name}"
                break
        time.sleep(POLL_INTERVAL)
    else:
        raise TimeoutError(f"App {app_name} did not reach RUNNING state within {MAX_POLLS} polls")

    # Phase 2: poll /agent/info until the app is actually serving
    _log(f"App is RUNNING at {app_url}, polling /agent/info...")
    token = get_oauth_token(profile)
    for _ in range(MAX_POLLS):
        try:
            resp = requests.get(
                f"{app_url}/agent/info",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            _log(f"  /agent/info status={resp.status_code}")
            if resp.status_code < 500:
                return app_url
        except requests.RequestException as exc:
            _log(f"  /agent/info error: {exc}")
        time.sleep(POLL_INTERVAL)

    raise TimeoutError(
        f"App {app_name} is RUNNING but /agent/info did not respond within {MAX_POLLS} polls"
    )


def get_oauth_token(profile: str) -> str:
    """Get token from `databricks auth token -p <profile>`."""
    result = _run_cmd(
        ["databricks", "auth", "token", "-p", profile],
        timeout=60,
    )
    assert result.returncode == 0, f"Failed to get auth token: {result.stderr}"
    data = json.loads(result.stdout)
    token = data.get("access_token", "")
    assert token, "No access_token in auth response"
    return token


def capture_app_logs(app_name: str, profile: str) -> str:
    """Capture app logs via `databricks apps logs`. Returns log output or empty string."""
    try:
        result = _run_cmd(
            ["databricks", "apps", "logs", app_name, "-p", profile],
            timeout=30,
        )
        return result.stdout if result.returncode == 0 else ""
    except Exception as exc:
        _log(f"WARNING: Failed to capture logs for {app_name}: {exc}")
        return ""


def grant_lakebase_access(app_name: str, lakebase: str, profile: str):
    """Grant the app's service principal access to the lakebase instance.

    Best-effort: prints warnings on failure, never raises.
    """
    try:
        result = _run_cmd(
            ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
            timeout=60,
        )
        assert result.returncode == 0, f"Failed to get app info: {result.stderr}"
        data = json.loads(result.stdout)
        sp_name = data.get("service_principal_name", "")
        assert sp_name, f"No service_principal_name found for app {app_name}"

        client = LakebaseClient(instance_name=lakebase)
        try:
            _log(f"Granting lakebase access to SP {sp_name}...")
            client.create_role(sp_name, "SERVICE_PRINCIPAL")
            client.grant_schema(
                grantee=sp_name,
                privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
                schemas=["public"],
            )
            client.grant_all_tables_in_schema(
                grantee=sp_name,
                privileges=[TablePrivilege.ALL],
                schemas=["public"],
            )
            client.grant_all_sequences_in_schema(
                grantee=sp_name,
                privileges=[SequencePrivilege.ALL],
                schemas=["public"],
            )
            _log(f"Lakebase access granted to {sp_name}.")
        finally:
            client.close()
    except Exception as exc:
        _log(f"WARNING: grant_lakebase_access failed for {app_name}: {exc}")


def query_with_openai_sdk(
    base_url: str,
    token: str | None,
    message: str,
    stream: bool = False,
) -> str:
    """Use OpenAI SDK to test /responses endpoint. Return response text.

    Works for both local (token=None, uses dummy key) and deployed (token=Bearer).
    When stream=True, uses the streaming API and collects text from events.
    """
    from openai import OpenAI

    mode = "streaming" if stream else "non-streaming"
    _log(f"Querying {base_url} via OpenAI SDK ({mode})...")
    client = OpenAI(
        base_url=base_url,
        api_key=token or "dummy",
    )
    if stream:
        text_parts: list[str] = []
        with client.responses.stream(
            model="agent",
            input=[{"role": "user", "content": message}],
        ) as resp_stream:
            for event in resp_stream:
                if hasattr(event, "delta") and event.delta:
                    text_parts.append(event.delta)
        output_text = "".join(text_parts)
    else:
        response = client.responses.create(
            model="agent",
            input=[{"role": "user", "content": message}],
        )
        output_text = response.output_text
    _log(f"  OpenAI SDK response ({mode}): {output_text[:500]}")
    return output_text



