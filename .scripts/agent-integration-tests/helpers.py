import json
import os
import select
import shutil
import signal
import socket
import subprocess
import threading
import time
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path

import requests
from databricks_ai_bridge.lakebase import LakebaseClient
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
# Logging & subprocess
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


def _run_with_retries(
    cmd: list[str],
    *,
    cwd: Path,
    label: str,
    max_attempts: int = MAX_POLLS,
    timeout: int = BUNDLE_TIMEOUT,
    recover: Callable[[str, int, int], bool] | None = None,
):
    """Run a command with retries.

    recover(stderr, attempt, max_attempts) is called on failure and returns
    True to retry or False to give up.
    """
    for attempt in range(1, max_attempts + 1):
        result = _run_cmd(cmd, cwd=cwd, timeout=timeout)
        if result.returncode == 0:
            return result
        if attempt < max_attempts and recover and recover(result.stderr, attempt, max_attempts):
            continue
        break
    assert result.returncode == 0, (
        f"{label} failed in {cwd.name}:\nstdout: {result.stdout}\nstderr: {result.stderr}"
    )


# ---------------------------------------------------------------------------
# Setup & cleanup
# ---------------------------------------------------------------------------


def clean_template(template_dir: Path):
    """Remove local dev artifacts (.venv/, uv.lock, .env) and bundle state."""
    for name in [".venv", "uv.lock", ".env", ".bundle", ".databricks"]:
        target = template_dir / name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.is_file():
            target.unlink()


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


def apply_edits(edits: list[FileEdit], template_dir: Path) -> list[tuple[Path, str]]:
    """Apply file edits. Returns list of (path, original_content) for revert.

    Edits are grouped by file so each file is read and written exactly once,
    even when multiple edits target the same file.
    """
    grouped: dict[Path, list[FileEdit]] = defaultdict(list)
    for edit in edits:
        grouped[template_dir / edit.relative_path].append(edit)

    originals: list[tuple[Path, str]] = []
    for filepath, file_edits in grouped.items():
        content = filepath.read_text()
        originals.append((filepath, content))
        for edit in file_edits:
            assert edit.old in content, (
                f"Could not find expected text in {filepath}:\nLooking for: {edit.old[:100]}..."
            )
            content = content.replace(edit.old, edit.new, 1)
            _log(f"Applied edit to {edit.relative_path}")
        filepath.write_text(content)
    return originals


def revert_edits(originals: list[tuple[Path, str]]):
    """Write back original file contents."""
    for filepath, content in originals:
        filepath.write_text(content)


# ---------------------------------------------------------------------------
# Local server
# ---------------------------------------------------------------------------


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
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        preexec_fn=os.setsid,
    )

    deadline = time.time() + SERVER_START_TIMEOUT
    while time.time() < deadline:
        if proc.poll() is not None:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise RuntimeError(
                f"Server process exited early (code {proc.returncode}):\n"
                f"stderr: {stderr}"
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


def run_test_agent(template_dir: Path, port: int = 8000):
    """Run `uv run python test_agent.py` for non-conversational template."""
    result = _run_cmd(
        ["uv", "run", "python", "test_agent.py", "--url", f"http://localhost:{port}"],
        cwd=template_dir,
        timeout=QUERY_TIMEOUT,
    )
    assert result.returncode == 0, (
        f"test_agent.py failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


# ---------------------------------------------------------------------------
# Endpoint queries
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
    data = resp.json()
    _log(f"  response: {json.dumps(data, indent=2)[:1000]}")
    return data


def query_endpoint_stream(
    base_url: str,
    payload: dict,
    endpoint: str = "/responses",
    extra_headers: dict[str, str] | None = None,
) -> None:
    """POST with stream=True, validate SSE response with at least one data: event."""
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
        resp_stream = client.responses.create(
            model="agent",
            input=[{"role": "user", "content": message}],
            stream=True,
        )
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


# ---------------------------------------------------------------------------
# Bundle commands (deploy / run / destroy)
# ---------------------------------------------------------------------------


def _bundle_unbind(
    template_dir: Path,
    app_resource_key: str,
    profile: str,
):
    """Unbind a DAB app resource to clear stale state."""
    _run_cmd(
        [
            "databricks",
            "bundle",
            "deployment",
            "unbind",
            app_resource_key,
            "--target",
            "dev",
            "-p",
            profile,
        ],
        cwd=template_dir,
        timeout=BUNDLE_TIMEOUT,
    )


def bundle_deploy(
    template_dir: Path,
    profile: str,
    app_resource_key: str,
    app_name: str,
):
    """Run `databricks bundle deploy --target dev -p <profile>`.

    Handles transient errors with automatic recovery:
    - Terraform init failures (e.g. GitHub 502): wait and retry
    - "already exists" (app): unbind stale state + bind existing app, retry
    - "does not exist or is deleted": unbind stale reference, retry
    """

    def recover(stderr: str, attempt: int, max_attempts: int) -> bool:
        if "terraform init" in stderr:
            _log(
                f"bundle deploy attempt {attempt}/{max_attempts} failed in "
                f"{template_dir.name} (terraform init error), retrying in {POLL_INTERVAL}s..."
            )
            time.sleep(POLL_INTERVAL)
            return True

        if "already exists" in stderr:
            _log(
                f"bundle deploy attempt {attempt}/{max_attempts} failed in "
                f"{template_dir.name} (app already exists), unbinding and binding..."
            )
            _bundle_unbind(template_dir, app_resource_key, profile)
            _run_cmd(
                [
                    "databricks",
                    "bundle",
                    "deployment",
                    "bind",
                    app_resource_key,
                    app_name,
                    "--auto-approve",
                    "--target",
                    "dev",
                    "-p",
                    profile,
                ],
                cwd=template_dir,
                timeout=BUNDLE_TIMEOUT,
            )
            return True

        if "does not exist or is deleted" in stderr:
            _log(
                f"bundle deploy attempt {attempt}/{max_attempts} failed in "
                f"{template_dir.name} (stale state), unbinding and retrying..."
            )
            _bundle_unbind(template_dir, app_resource_key, profile)
            time.sleep(POLL_INTERVAL)
            return True

        return False

    _run_with_retries(
        ["databricks", "bundle", "deploy", "--target", "dev", "-p", profile],
        cwd=template_dir,
        label="bundle deploy",
        recover=recover,
    )


def bundle_run(template_dir: Path, resource_key: str, profile: str):
    """Run `databricks bundle run <resource_key> --target dev` to start the app."""
    _log(f"Starting app via bundle run {resource_key}...")

    def recover(stderr: str, attempt: int, max_attempts: int) -> bool:
        _log(
            f"bundle run attempt {attempt}/{max_attempts} failed in "
            f"{template_dir.name}, retrying in {POLL_INTERVAL}s..."
        )
        time.sleep(POLL_INTERVAL)
        return True

    _run_with_retries(
        ["databricks", "bundle", "run", resource_key, "--target", "dev", "-p", profile],
        cwd=template_dir,
        label="bundle run",
        recover=recover,
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


# ---------------------------------------------------------------------------
# App management (readiness, auth, logs)
# ---------------------------------------------------------------------------


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


def wait_for_app_ready(app_name: str, profile: str) -> tuple[str, str]:
    """Poll `databricks apps get` until RUNNING, then poll /agent/info until responsive.

    Returns (app_url, oauth_token).
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
                return app_url, token
        except requests.RequestException as exc:
            _log(f"  /agent/info error: {exc}")
        time.sleep(POLL_INTERVAL)

    raise TimeoutError(
        f"App {app_name} is RUNNING but /agent/info did not respond within {MAX_POLLS} polls"
    )


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


# ---------------------------------------------------------------------------
# Lakebase
# ---------------------------------------------------------------------------

_MANAGED_SCHEMAS = ["public", "drizzle", "ai_chatbot"]


def _try_sql(client, sql: str):
    """Execute SQL, logging but not raising on failure."""
    try:
        client.execute(sql)
    except Exception as exc:
        _log(f"  SQL warning: {exc!r} for: {sql}")


def grant_lakebase_access(app_name: str, lakebase: str, profile: str):
    """Grant the app's service principal Lakebase access.

    Assumes the SP's postgres role already exists (created by the ``database``
    resource in databricks.yml at deploy time).
    """
    from databricks_ai_bridge.lakebase import SchemaPrivilege, SequencePrivilege, TablePrivilege

    try:
        result = _run_cmd(
            ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
            timeout=60,
        )
        assert result.returncode == 0, f"Failed to get app info: {result.stderr}"
        data = json.loads(result.stdout)
        sp_client_id = data.get("service_principal_client_id", "")
        assert sp_client_id, f"No service_principal_client_id found for app {app_name}"

        with LakebaseClient(instance_name=lakebase) as client:
            _log(f"Granting lakebase access to SP {sp_client_id}...")
            quoted_sp = f'"{sp_client_id}"'

            # Grant CREATE on database so the SP can create schemas
            _try_sql(client, f"GRANT CREATE ON DATABASE databricks_postgres TO {quoted_sp};")

            # Grant schema/table/sequence privileges on each managed schema that exists
            rows = client.execute(
                "SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY(%s);",
                (_MANAGED_SCHEMAS,),
            )
            existing_schemas = [r["schema_name"] for r in rows] if rows else []
            _log(f"  Existing managed schemas: {existing_schemas}")

            if existing_schemas:
                client.grant_schema(
                    grantee=sp_client_id,
                    privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
                    schemas=existing_schemas,
                )
                client.grant_all_tables_in_schema(
                    grantee=sp_client_id,
                    privileges=[TablePrivilege.ALL],
                    schemas=existing_schemas,
                )
                client.grant_all_sequences_in_schema(
                    grantee=sp_client_id,
                    privileges=[SequencePrivilege.ALL],
                    schemas=existing_schemas,
                )

            _log(f"Lakebase access granted to {sp_client_id}.")
    except Exception as exc:
        raise RuntimeError(f"grant_lakebase_access failed for {app_name}: {exc}") from exc
