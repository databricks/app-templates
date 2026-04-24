import json
import os
import re
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
MAX_POLLS = 20  # max number of polls before giving up (10 min for cold starts)
QUERY_TIMEOUT = 120  # seconds for HTTP requests
BUNDLE_TIMEOUT = 600  # seconds for bundle deploy/run/destroy commands (10 min for parallel runs)
QUICKSTART_TIMEOUT = 600  # seconds for quickstart command (10 min for parallel runs)
EVALUATE_TIMEOUT = 900  # seconds for agent-evaluate
SERVER_START_TIMEOUT = 600  # seconds to wait for local server to start (accommodates cold CI runners + heavy template imports)

# ---------------------------------------------------------------------------
# Logging & subprocess
# ---------------------------------------------------------------------------
# Design: stdout is the human-readable stream (timestamps, ✓/✗ markers,
# collapsible GH Actions groups, short summaries on subprocess success).
# The per-thread log file (logs/{template}.log) gets the full unstructured
# text — including every subprocess's stdout/stderr — so post-mortem grep
# and paste-into-playbook workflows keep working unchanged.
#
# Two rules of thumb:
#   * _log()    prints to both stdout (with timestamp) and log file (raw).
#   * _run_cmd: terse on stdout when successful, full detail on failure;
#     always writes full detail to the log file.
_thread_local = threading.local()
_log_lock = threading.Lock()

# Only emit GH Actions log-grouping directives when running under Actions.
# Outside CI they'd just be noise in developer terminals.
_IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"


def set_log_file(log_file: Path | None):
    """Set the log file for the current thread."""
    _thread_local.log_file = log_file


def _ts() -> str:
    """Short HH:MM:SS timestamp for stdout log-line prefixes."""
    return time.strftime("%H:%M:%S")


def _fmt_duration(seconds: float) -> str:
    """Human-friendly duration: '0.4s', '12.1s', '1m 23s', '1h 2m 3s'."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    m, s = divmod(int(seconds), 60)
    if m < 60:
        return f"{m}m {s}s"
    h, m = divmod(m, 60)
    return f"{h}h {m}m {s}s"


def _write_to_log_file(msg: str) -> None:
    """Append raw text (no timestamp) to the current thread's log file."""
    log_file = getattr(_thread_local, "log_file", None)
    if log_file is None:
        return
    with _log_lock, open(log_file, "a") as f:
        f.write(msg + "\n")


def _log(msg: str) -> None:
    """Log to stdout (with timestamp) and log file (raw).

    Multi-line messages: timestamp only on the first line so continuation
    lines stay aligned and the file copy is byte-identical to the message.
    """
    if msg == "":
        print("")
    else:
        lines = msg.split("\n")
        print(f"[{_ts()}] {lines[0]}")
        for line in lines[1:]:
            print(line)
    _write_to_log_file(msg)


def _gh_group(title: str) -> None:
    """Open a collapsible GH Actions log group (no-op outside CI)."""
    if _IN_CI:
        print(f"::group::{title}")


def _gh_endgroup() -> None:
    """Close the current GH Actions log group (no-op outside CI)."""
    if _IN_CI:
        print("::endgroup::")


def _run_cmd(cmd: list[str], *, verbose: bool = False, **kwargs) -> subprocess.CompletedProcess:
    """Run a subprocess and return the result.

    Logging behaviour:
      * Full command + exit + stdout + stderr always go to the log file.
      * Stdout (the CI log stream) gets a one-line summary on success
        — ``✓ <cmd>  (<duration>)`` — and full detail on failure.
      * Pass ``verbose=True`` to force full output on both paths (useful
        when the command's output is itself the test signal).
    """
    kwargs.setdefault("capture_output", True)
    kwargs.setdefault("text", True)
    cmd_str = " ".join(cmd)
    short_cmd = " ".join(cmd[:3]) + ("..." if len(cmd) > 3 else "")
    t0 = time.monotonic()

    _write_to_log_file(f"$ {cmd_str}")

    try:
        result = subprocess.run(cmd, **kwargs)
    except subprocess.TimeoutExpired:
        duration = time.monotonic() - t0
        # Make timeouts loud on stdout; the file gets the same line plus
        # any partial output captured by the caller.
        print(f"[{_ts()}] ✗ timeout: {cmd_str}  (after {_fmt_duration(duration)})")
        _write_to_log_file(f"  TIMEOUT after {_fmt_duration(duration)}")
        raise

    duration = time.monotonic() - t0

    _write_to_log_file(f"  exit={result.returncode}  ({_fmt_duration(duration)})")
    if result.stdout:
        _write_to_log_file(f"  stdout:\n{result.stdout.rstrip()}")
    if result.stderr:
        _write_to_log_file(f"  stderr:\n{result.stderr.rstrip()}")

    if result.returncode == 0 and not verbose:
        print(f"[{_ts()}] ✓ {short_cmd}  ({_fmt_duration(duration)})")
    else:
        marker = "✓" if result.returncode == 0 else "✗"
        print(f"[{_ts()}] {marker} {cmd_str}  (exit {result.returncode}, {_fmt_duration(duration)})")
        if result.stdout:
            print(f"  stdout:\n{result.stdout.rstrip()}")
        if result.stderr:
            print(f"  stderr:\n{result.stderr.rstrip()}")

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
        try:
            result = _run_cmd(cmd, cwd=cwd, timeout=timeout)
        except subprocess.TimeoutExpired:
            _log(f"  timed out after {timeout}s")
            if attempt < max_attempts and recover and recover(f"timed out after {timeout}s", attempt, max_attempts):
                continue
            raise
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


def copy_template(template_dir: Path, app_name_suffix: str = "-p") -> Path:
    """Copy a template directory to a temporary location for isolated parallel runs.

    After copying, patches both the bundle name and app name in databricks.yml
    with the given suffix so the copy deploys to a different workspace path and
    app than the original (avoiding terraform state races).
    Returns the path to the temporary copy.
    """
    import tempfile

    tmp_parent = Path(tempfile.mkdtemp(prefix=f"{template_dir.name}-"))
    tmp_dir = tmp_parent / template_dir.name
    shutil.copytree(
        template_dir,
        tmp_dir,
        ignore=shutil.ignore_patterns(".venv", ".bundle", ".databricks", ".env", "__pycache__", "*.pyc"),
    )

    yml_path = tmp_dir / "databricks.yml"
    if yml_path.exists():
        text = yml_path.read_text()
        # Patch bundle.name (the first top-level `name:` in the file —
        # unquoted identifier like `agent_langgraph_advanced`) so the
        # copy gets its own workspace path .bundle/<name>/ and its own
        # terraform state. Previously the regex required quoted values
        # and silently no-op'd on unquoted bundle.name, meaning the
        # "isolated" copy actually shared state with the original —
        # terraform state races and source-upload collisions ensued.
        # e.g. `  name: agent_langgraph_advanced` ->
        #      `  name: agent_langgraph_advanced_p`
        suffix_underscore = app_name_suffix.replace("-", "_")
        patched = re.sub(
            r"^(\s*name:\s*)(\w+)(\s*)$",
            lambda m: m.group(1) + m.group(2) + suffix_underscore + m.group(3),
            text,
            count=1,
            flags=re.MULTILINE,
        )
        # Patch the app name under resources.apps.<key>:
        #   name: "some-app-name"  or  name: "${bundle.target}-some-suffix"
        patched = re.sub(
            r'(^\s*apps:\s*\n\s*\w+:\s*\n\s*name:\s*")(.*?)(")',
            lambda m: m.group(1) + m.group(2) + app_name_suffix + m.group(3),
            patched,
            count=1,
            flags=re.MULTILINE,
        )
        yml_path.write_text(patched)

    return tmp_dir


def clean_template(template_dir: Path):
    """Remove local dev artifacts (.env, uv.lock) and bundle state.

    Keeps .venv/ intact to avoid full reinstalls — uv will sync it on next run.
    """
    for name in [".env", ".bundle", ".databricks"]:
        target = template_dir / name
        try:
            if target.is_dir():
                shutil.rmtree(target)
            elif target.is_file():
                target.unlink()
        except FileNotFoundError:
            pass  # Already removed by another parallel worker


def uv_sync(template_dir: Path):
    """Run `uv sync` to create/update the venv before quickstart.

    Tries online first; falls back to UV_OFFLINE=true on failure (useful when
    git+ deps are cached locally and the network fetch hangs or fails).
    """
    result = _run_cmd(["uv", "sync"], cwd=template_dir, timeout=QUICKSTART_TIMEOUT)
    if result.returncode == 0:
        return
    _log(f"  uv sync failed online, retrying with UV_OFFLINE=true...")
    env = os.environ.copy()
    env["UV_OFFLINE"] = "true"
    result = _run_cmd(["uv", "sync"], cwd=template_dir, timeout=QUICKSTART_TIMEOUT, env=env)
    assert result.returncode == 0, (
        f"uv sync failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def _strip_uv_sources(template_dir: Path) -> str | None:
    """Temporarily strip [tool.uv.sources] for deploy.

    Returns the original content so it can be restored, or None if no change.
    Also deletes uv.lock since it may contain local paths.
    """
    pyproject = template_dir / "pyproject.toml"
    if not pyproject.exists():
        return None
    original = pyproject.read_text()
    stripped = re.sub(
        r"\n\[tool\.uv\.sources\]\n(?:.*\n)*?(?=\n\[|\Z)",
        "\n",
        original,
    )
    if stripped == original:
        return None
    pyproject.write_text(stripped)
    lock = template_dir / "uv.lock"
    if lock.exists():
        lock.unlink()
    _log(f"Stripped [tool.uv.sources] from {pyproject.name} for deploy")
    return original


def _restore_uv_sources(template_dir: Path, original: str | None):
    """Restore pyproject.toml after deploy."""
    if original is None:
        return
    pyproject = template_dir / "pyproject.toml"
    pyproject.write_text(original)
    _log(f"Restored [tool.uv.sources] in {pyproject.name}")


def run_quickstart(
    template_dir: Path,
    profile: str,
    lakebase: str | None = None,
    lakebase_autoscaling_endpoint: str | None = None,
    app_name: str | None = None,
    skip_lakebase: bool = False,
) -> subprocess.CompletedProcess:
    """Run `uv run quickstart --profile <profile>`. Returns the completed process."""
    cmd = ["uv", "run", "quickstart", "--profile", profile]
    if lakebase:
        cmd.extend(["--lakebase-provisioned-name", lakebase])
    if lakebase_autoscaling_endpoint:
        cmd.extend(["--lakebase-autoscaling-endpoint", lakebase_autoscaling_endpoint])
    if app_name:
        cmd.extend(["--app-name", app_name])
    if skip_lakebase:
        cmd.append("--skip-lakebase")
    result = _run_cmd(cmd, cwd=template_dir, timeout=QUICKSTART_TIMEOUT)
    assert result.returncode == 0, (
        f"quickstart failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )
    return result



def git_copy_template(template_name: str, dest: Path, git_ref: str | None = None) -> Path:
    """Copy a template directory to dest using git-tracked files only.

    Without git_ref: uses `git ls-files` so uncommitted modifications to tracked
    files are included (important for testing in-progress changes).

    With git_ref: uses `git archive` to extract files at a specific commit/branch.
    """
    import io
    import tarfile

    from template_config import REPO_ROOT

    template_dest = dest / template_name
    template_dest.mkdir(parents=True)

    if git_ref:
        result = subprocess.run(
            ["git", "archive", git_ref, "--", template_name],
            cwd=REPO_ROOT,
            capture_output=True,
            check=True,
        )
        with tarfile.open(fileobj=io.BytesIO(result.stdout)) as tar:
            for member in tar.getmembers():
                member.name = str(Path(member.name).relative_to(template_name))
                tar.extract(member, template_dest)
    else:
        result = subprocess.run(
            ["git", "ls-files", template_name],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        for rel_path in result.stdout.strip().splitlines():
            src = REPO_ROOT / rel_path
            dst = template_dest / Path(rel_path).relative_to(template_name)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    return template_dest


def read_env_value(env_file: Path, key: str) -> str | None:
    """Read a single key from a .env file. Returns None if not found."""
    import re

    if not env_file.exists():
        return None
    content = env_file.read_text()
    match = re.search(rf"^{re.escape(key)}=(.*)$", content, re.MULTILINE)
    return match.group(1).strip() if match else None


def databricks_create_app(app_name: str, profile: str):
    """Create a bare Databricks App (no compute) to simulate a UI-created app.

    Uses --no-compute so the app is in STOPPED state immediately, avoiding the
    'compute is in STARTING state' error when bundle deploy tries to update it.
    """
    result = _run_cmd(
        ["databricks", "apps", "create", app_name, "-p", profile, "--no-compute", "--no-wait"],
        timeout=60,
    )
    assert result.returncode == 0, f"Failed to create app {app_name}: {result.stderr}"


def start_app(app_name: str, profile: str):
    """Start a Databricks App without waiting. Let wait_for_app_ready() poll for readiness."""
    result = _run_cmd(
        ["databricks", "apps", "start", app_name, "--no-wait", "-p", profile],
        timeout=60,
    )
    assert result.returncode == 0, f"Failed to start app {app_name}: {result.stderr}"


def databricks_delete_app(app_name: str, profile: str):
    """Delete a Databricks App. Best-effort: logs warning on failure, never raises."""
    try:
        result = _run_cmd(
            ["databricks", "apps", "delete", app_name, "-p", profile],
            timeout=60,
        )
        if result.returncode != 0:
            _log(f"WARNING: Failed to delete app {app_name}: {result.stderr}")
    except Exception as exc:
        _log(f"WARNING: Error deleting app {app_name}: {exc}")


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
            if line.strip():
                _log(f"  server: {line.rstrip()}")
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
    stream: bool = False,
) -> dict | None:
    """POST to {base_url}{endpoint}. Returns JSON when stream=False, None when stream=True."""
    url = f"{base_url}{endpoint}"
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)

    if stream:
        _log(f"POST {url} (streaming)")
        resp = requests.post(
            url,
            json={**payload, "stream": True},
            headers=headers,
            timeout=QUERY_TIMEOUT,
            stream=True,
        )
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        assert "text/event-stream" in content_type, (
            f"Expected text/event-stream, got {content_type}"
        )
        has_data = any(
            line.startswith("data:") for line in resp.iter_lines(decode_unicode=True) if line
        )
        _log(f"  streaming: content_type={content_type}, has_data={has_data}")
        assert has_data, "No SSE data: events received in stream response"
        return None

    _log(f"POST {url}")
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
    - "lineage mismatch in state files": a prior run left stale terraform
      state on the same bundle path. Unbind and wipe local state, retry.
    """

    def recover(stderr: str, attempt: int, max_attempts: int) -> bool:
        # Normalize newlines for multi-line error messages
        stderr_flat = " ".join(stderr.split())
        if "terraform init" in stderr_flat:
            _log(
                f"bundle deploy attempt {attempt}/{max_attempts} failed in "
                f"{template_dir.name} (terraform init error), retrying in {POLL_INTERVAL}s..."
            )
            time.sleep(POLL_INTERVAL)
            return True

        if "already exists" in stderr_flat:
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

        if "does not exist" in stderr_flat:
            _log(
                f"bundle deploy attempt {attempt}/{max_attempts} failed in "
                f"{template_dir.name} (stale state), unbinding and retrying..."
            )
            _bundle_unbind(template_dir, app_resource_key, profile)
            time.sleep(POLL_INTERVAL)
            return True

        if "lineage mismatch" in stderr_flat:
            _log(
                f"bundle deploy attempt {attempt}/{max_attempts} failed in "
                f"{template_dir.name} (tf state lineage mismatch), unbinding "
                f"and wiping local state..."
            )
            _bundle_unbind(template_dir, app_resource_key, profile)
            # Remove local terraform state copy; a fresh deploy will repopulate.
            databricks_state = template_dir / ".databricks"
            if databricks_state.is_dir():
                shutil.rmtree(databricks_state, ignore_errors=True)
            time.sleep(POLL_INTERVAL)
            return True

        if "is not terminal" in stderr_flat or "not terminal with state" in stderr_flat:
            _log(
                f"bundle deploy attempt {attempt}/{max_attempts} failed in "
                f"{template_dir.name} (app transitioning), waiting {POLL_INTERVAL}s..."
            )
            time.sleep(POLL_INTERVAL)
            return True

        if "DELETING" in stderr_flat:
            _log(
                f"bundle deploy attempt {attempt}/{max_attempts} failed in "
                f"{template_dir.name} (compute deleting), waiting {POLL_INTERVAL}s..."
            )
            time.sleep(POLL_INTERVAL)
            return True

        return False

    # Strip [tool.uv.sources] so deploy doesn't upload uv.lock with local paths
    pyproject_backup = _strip_uv_sources(template_dir)
    try:
        _run_with_retries(
            ["databricks", "bundle", "deploy", "--target", "dev", "-p", profile],
            cwd=template_dir,
            label="bundle deploy",
            recover=recover,
        )
    finally:
        _restore_uv_sources(template_dir, pyproject_backup)


def bundle_run_nowait(
    template_dir: Path,
    resource_key: str,
    profile: str,
    app_name: str | None = None,
):
    """Trigger `databricks bundle run` to start the app, then return quickly.

    Despite --no-wait, the CLI may still poll briefly for startup. We cap
    the wait at 90s and swallow timeout errors — the app start was initiated
    on the server side and will continue even if the CLI process is killed.
    Use wait_for_app_ready() after this to poll until RUNNING.

    Recovery: if bundle run fails with "Invalid source code path ... does
    not exist", the prior `bundle deploy` didn't fully upload the bundle
    source (known failure mode when a previous run's cleanup left the app
    definition bound but wiped its source dir). Re-run bundle_deploy to
    force a fresh upload, then retry bundle_run once. ``app_name`` must be
    provided to enable this recovery.
    """
    import subprocess as _subprocess

    cmd = [
        "databricks", "bundle", "run", resource_key,
        "--no-wait", "--target", "dev", "-p", profile,
    ]
    for attempt in range(1, 3):
        try:
            result = _run_cmd(cmd, cwd=template_dir, timeout=BUNDLE_TIMEOUT)
        except _subprocess.TimeoutExpired:
            _log(
                f"bundle run --no-wait for {resource_key} timed out after {BUNDLE_TIMEOUT}s "
                f"— app start was initiated, polling via wait_for_app_ready()"
            )
            return

        if result.returncode == 0:
            return

        stderr_flat = " ".join(result.stderr.split())
        if "Invalid source code path" in stderr_flat and app_name and attempt == 1:
            _log(
                f"bundle run failed: source_code_path missing on workspace "
                f"(likely stale state from prior run); re-deploying to "
                f"re-upload source, then retrying..."
            )
            bundle_deploy(template_dir, profile, resource_key, app_name)
            continue

        # Other failure mode — log and let wait_for_app_ready surface it.
        _log(
            f"bundle run --no-wait for {resource_key} exited {result.returncode}; "
            f"proceeding to wait_for_app_ready (may time out)"
        )
        return


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
    """Get an OAuth bearer token for the given Databricks CLI profile.

    Uses the Databricks SDK so this works for both U2M (personal OAuth) and
    M2M (service-principal client_id/client_secret) profiles. The CLI's
    `databricks auth token` subcommand only supports U2M, which breaks
    CI runs against an SP profile.
    """
    from databricks.sdk import WorkspaceClient

    w = WorkspaceClient(profile=profile)
    auth_header = w.config.authenticate()
    token = auth_header.get("Authorization", "").removeprefix("Bearer ").strip()
    assert token, f"No OAuth token returned for profile {profile!r}"
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

_MANAGED_SCHEMAS = ["public", "drizzle", "ai_chatbot", "agent_server"]


def _try_sql(client, sql: str):
    """Execute SQL, logging but not raising on failure."""
    try:
        client.execute(sql)
    except Exception as exc:
        _log(f"  SQL warning: {exc!r} for: {sql}")


def grant_lakebase_access(
    app_name: str,
    profile: str,
    instance_name: str | None = None,
    autoscaling_endpoint: str | None = None,
):
    """Grant the app's service principal Lakebase access.

    Assumes the SP's postgres role already exists (created by the ``database``
    resource in databricks.yml at deploy time).

    Pass either ``instance_name`` (provisioned) or ``autoscaling_endpoint`` (autoscaling).
    """
    from databricks_ai_bridge.lakebase import SchemaPrivilege, TablePrivilege

    try:
        result = _run_cmd(
            ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
            timeout=60,
        )
        assert result.returncode == 0, f"Failed to get app info: {result.stderr}"
        data = json.loads(result.stdout)
        sp_client_id = data.get("service_principal_client_id", "")
        assert sp_client_id, f"No service_principal_client_id found for app {app_name}"

        if instance_name:
            client_ctx = LakebaseClient(instance_name=instance_name)
        elif autoscaling_endpoint:
            client_ctx = LakebaseClient(autoscaling_endpoint=autoscaling_endpoint)
        else:
            raise ValueError("Either instance_name or autoscaling_endpoint required")

        with client_ctx as client:
            _log(f"Granting lakebase access to SP {sp_client_id}...")
            quoted_sp = f'"{sp_client_id}"'

            # Ensure the SP's postgres role exists
            try:
                client.create_role(sp_client_id, "SERVICE_PRINCIPAL")
                _log(f"  Created role for SP {sp_client_id}")
            except Exception as exc:
                if "already exists" in str(exc).lower():
                    _log(f"  Role already exists for SP {sp_client_id}")
                else:
                    _log(f"  Role creation warning: {exc}")

            # Grant CREATE on database so the SP can create schemas
            _try_sql(client, f"GRANT CREATE ON DATABASE databricks_postgres TO {quoted_sp};")

            # Find managed schemas that exist
            rows = client.execute(
                "SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY(%s);",
                (_MANAGED_SCHEMAS,),
            )
            existing_schemas = [r["schema_name"] for r in rows] if rows else []
            _log(f"  Existing managed schemas: {existing_schemas}")

            if existing_schemas:
                # SDK-level grants (schema + tables) — best-effort, may fail
                # on autoscaling if tables are owned by other users
                try:
                    client.grant_schema(
                        grantee=sp_client_id,
                        privileges=[SchemaPrivilege.USAGE, SchemaPrivilege.CREATE],
                        schemas=existing_schemas,
                    )
                except Exception as exc:
                    _log(f"  Schema grant warning: {exc}")
                try:
                    client.grant_all_tables_in_schema(
                        grantee=sp_client_id,
                        privileges=[TablePrivilege.ALL],
                        schemas=existing_schemas,
                    )
                except Exception as exc:
                    _log(f"  Table grant warning: {exc}")

                # Raw SQL grants for tables and sequences.
                # Note: GRANT ALL on sequences includes DELETE which is invalid
                # for sequences (SQLSTATE 0LP01). Use specific privileges instead.
                for schema in existing_schemas:
                    _try_sql(
                        client,
                        f"GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA {schema} TO {quoted_sp};",
                    )
                    _try_sql(
                        client,
                        f"GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA {schema} TO {quoted_sp};",
                    )

                # Workaround for Lakebase bug: the on_create_sequence event trigger
                # only grants to databricks_superuser (not to individual users like
                # on_create_table does). So bulk sequence grants silently skip
                # sequences owned by other users. SET ROLE to databricks_superuser
                # (which HAS been granted on all sequences) to execute grants with
                # that role's privileges.
                _log("  Attempting sequence grants via SET ROLE databricks_superuser...")
                try:
                    client.execute("SET ROLE databricks_superuser;")
                    for schema in existing_schemas:
                        _try_sql(
                            client,
                            f"GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA {schema} TO {quoted_sp};",
                        )
                    # Also grant on individual sequences by name as a fallback
                    seq_rows = client.execute(
                        "SELECT schemaname, sequencename FROM pg_sequences WHERE schemaname = ANY(%s);",
                        ([s for s in existing_schemas],),
                    )
                    if seq_rows:
                        for seq in seq_rows:
                            _try_sql(
                                client,
                                f"GRANT USAGE, SELECT, UPDATE ON SEQUENCE "
                                f"{seq['schemaname']}.{seq['sequencename']} TO {quoted_sp};",
                            )
                        _log(f"  Granted on {len(seq_rows)} individual sequence(s) via databricks_superuser")
                    client.execute("RESET ROLE;")
                except Exception as exc:
                    _log(f"  SET ROLE databricks_superuser failed: {exc}")
                    # Try RESET ROLE in case SET ROLE succeeded but grants failed
                    try:
                        client.execute("RESET ROLE;")
                    except Exception:
                        pass
                    # Fall back to granting as current user (individual sequences)
                    seq_rows = client.execute(
                        "SELECT schemaname, sequencename FROM pg_sequences WHERE schemaname = ANY(%s);",
                        ([s for s in existing_schemas],),
                    )
                    if seq_rows:
                        for seq in seq_rows:
                            _try_sql(
                                client,
                                f"GRANT USAGE, SELECT, UPDATE ON SEQUENCE "
                                f"{seq['schemaname']}.{seq['sequencename']} TO {quoted_sp};",
                            )
                        _log(f"  Granted on {len(seq_rows)} individual sequence(s) as current user (fallback)")

                # Log sequences owned by other users for debugging
                current_user = client.execute("SELECT current_user;")[0]["current_user"]
                stale_seqs = client.execute(
                    "SELECT schemaname, sequencename, sequenceowner FROM pg_sequences "
                    "WHERE schemaname = ANY(%s) AND sequenceowner NOT IN (%s, %s);",
                    ([s for s in existing_schemas], current_user, sp_client_id),
                )
                if stale_seqs:
                    for seq in stale_seqs:
                        _log(
                            f"  INFO: sequence {seq['schemaname']}.{seq['sequencename']} "
                            f"is owned by {seq['sequenceowner']}"
                        )

                # Grant default privileges so future tables/sequences created
                # in these schemas are automatically accessible to the SP
                for schema in existing_schemas:
                    _try_sql(
                        client,
                        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
                        f"GRANT SELECT, INSERT, UPDATE ON TABLES TO {quoted_sp};",
                    )
                    _try_sql(
                        client,
                        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
                        f"GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {quoted_sp};",
                    )

            _log(f"Lakebase access granted to {sp_client_id}.")
    except Exception as exc:
        raise RuntimeError(f"grant_lakebase_access failed for {app_name}: {exc}") from exc
