import json
import os
import select
import shutil
import signal
import socket
import subprocess
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


def _parse_yml_names(template_dir: Path) -> tuple[str, str] | None:
    """Parse bundle_name and app_name from databricks.yml. Returns None on failure."""
    import re

    yml_path = template_dir / "databricks.yml"
    if not yml_path.exists():
        return None
    text = yml_path.read_text()
    bundle_match = re.search(
        r"^bundle:\s*\n\s*name:\s*(\S+)", text, re.MULTILINE
    )
    app_match = re.search(
        r'^\s*apps:\s*\n\s*\w+:\s*\n\s*name:\s*"([^"]+)"', text, re.MULTILINE
    )
    if not bundle_match or not app_match:
        return None
    return bundle_match.group(1), app_match.group(1)


def _clean_bundle_state(template_dir: Path, profile: str):
    """Delete local .bundle/ and remote workspace terraform state."""
    bundle_dir = template_dir / ".bundle"
    if bundle_dir.is_dir():
        shutil.rmtree(bundle_dir)

    names = _parse_yml_names(template_dir)
    if not names:
        return
    bundle_name = names[0]

    user_result = subprocess.run(
        ["databricks", "current-user", "me", "-p", profile, "--output", "json"],
        capture_output=True, text=True, timeout=30,
    )
    if user_result.returncode == 0:
        user_name = json.loads(user_result.stdout).get("userName", "")
        if user_name:
            remote_path = (
                f"/Workspace/Users/{user_name}/.bundle/{bundle_name}"
            )
            subprocess.run(
                ["databricks", "workspace", "delete", remote_path,
                 "--recursive", "-p", profile],
                capture_output=True, text=True, timeout=30,
            )


def _delete_existing_app(template_dir: Path, profile: str):
    """Delete the Databricks app named in databricks.yml, if it exists."""
    names = _parse_yml_names(template_dir)
    if not names:
        return
    app_name = names[1]
    # Check if app exists
    result = subprocess.run(
        ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        return  # App doesn't exist
    # Delete the app
    subprocess.run(
        ["databricks", "apps", "delete", app_name, "-p", profile],
        capture_output=True, text=True, timeout=60,
    )
    print(f"Deleted existing app '{app_name}' during cleanup.")


def clean_template(template_dir: Path, profile: str = "dev"):
    """Remove .venv/, uv.lock, .env, .bundle, remote state, and existing apps."""
    for name in [".venv", "uv.lock", ".env", ".bundle"]:
        target = template_dir / name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.is_file():
            target.unlink()

    _clean_bundle_state(template_dir, profile)
    _delete_existing_app(template_dir, profile)


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


def find_free_port() -> int:
    """Bind to port 0 and return the OS-assigned free port.

    There is a small TOCTOU window between closing the socket and the server
    binding to the port, but the risk of collision is negligible in practice.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def start_server(
    template_dir: Path, port: int = 0
) -> tuple[subprocess.Popen, int]:
    """Start `uv run start-server` as background process.

    If port is 0 (default), dynamically allocates a free port.
    Waits for 'Uvicorn running on' in stderr (timeout 60s).
    Returns (process handle, port).
    """
    if port == 0:
        port = find_free_port()

    proc = subprocess.Popen(
        ["uv", "run", "start-server", "--port", str(port)],
        cwd=template_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        preexec_fn=os.setsid,
    )

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
                return proc, port
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
    if not resp.ok:
        body = resp.text[:2000]
        raise requests.HTTPError(
            f"{resp.status_code} for {resp.url}\nResponse body: {body}",
            response=resp,
        )
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


def _assert_sse_stream(
    base_url: str,
    payload: dict,
    endpoint: str,
    extra_headers: dict[str, str] | None = None,
) -> None:
    """POST with stream=True and validate the SSE response contains data."""
    stream_payload = {**payload, "stream": True}
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    resp = requests.post(
        f"{base_url}{endpoint}",
        json=stream_payload,
        headers=headers,
        timeout=120,
        stream=True,
    )
    resp.raise_for_status()
    content_type = resp.headers.get("content-type", "")
    assert "text/event-stream" in content_type, (
        f"Expected text/event-stream, got {content_type}"
    )
    has_data = any(
        line.startswith("data:")
        for line in resp.iter_lines(decode_unicode=True)
        if line
    )
    assert has_data, "No SSE data: events received in stream response"


def query_endpoint_stream(
    base_url: str, payload: dict, endpoint: str = "/responses"
) -> None:
    """POST with stream=True, validate SSE response with at least one data: event."""
    _assert_sse_stream(base_url, payload, endpoint)


def query_endpoint_stream_with_auth(
    base_url: str, token: str, payload: dict, endpoint: str
) -> None:
    """POST with stream=True and Bearer token, validate SSE response."""
    _assert_sse_stream(
        base_url, payload, endpoint, {"Authorization": f"Bearer {token}"}
    )


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
            f"Could not find expected text in {filepath}:\n"
            f"Looking for: {edit.old[:100]}..."
        )
        filepath.write_text(current.replace(edit.old, edit.new, 1))
    return list(seen.items())


def revert_edits(originals: list[tuple[Path, str]]):
    """Write back original file contents."""
    for filepath, content in originals:
        filepath.write_text(content)


# --- Deploy helpers ---


def bundle_deploy(template_dir: Path, profile: str, retries: int = 3):
    """Run `databricks bundle deploy --target dev -p <profile>`.

    Handles transient errors with automatic recovery:
    - Terraform init failures (e.g. GitHub 502): wait and retry
    - "already exists": delete existing app + clean state, retry
    - "does not exist or is deleted": clean stale state, retry
    """
    for attempt in range(1, retries + 1):
        result = subprocess.run(
            ["databricks", "bundle", "deploy", "--target", "dev", "-p", profile],
            cwd=template_dir,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 0:
            return

        stderr = result.stderr
        if attempt < retries:
            if "terraform init" in stderr:
                print(
                    f"bundle deploy attempt {attempt}/{retries} failed in "
                    f"{template_dir.name} (terraform init error), retrying in 30s..."
                )
                time.sleep(30)
                continue

            if "already exists" in stderr:
                print(
                    f"bundle deploy attempt {attempt}/{retries} failed in "
                    f"{template_dir.name} (app already exists), cleaning up..."
                )
                _delete_existing_app(template_dir, profile)
                _clean_bundle_state(template_dir, profile)
                continue

            if "does not exist or is deleted" in stderr:
                print(
                    f"bundle deploy attempt {attempt}/{retries} failed in "
                    f"{template_dir.name} (stale state), cleaning up..."
                )
                _clean_bundle_state(template_dir, profile)
                continue

        break
    assert result.returncode == 0, (
        f"bundle deploy failed in {template_dir.name}:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )


def bundle_destroy(template_dir: Path, profile: str):
    """Run `databricks bundle destroy --target dev` to clean up deployed resources.

    Best-effort: prints warnings on failure, never raises.
    """
    try:
        result = subprocess.run(
            [
                "databricks", "bundle", "destroy", "--target", "dev",
                "-p", profile, "--auto-approve",
            ],
            cwd=template_dir,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            print(
                f"WARNING: bundle destroy failed in {template_dir.name}:\n"
                f"stdout: {result.stdout}\nstderr: {result.stderr}"
            )
    except Exception as exc:
        print(f"WARNING: bundle destroy errored in {template_dir.name}: {exc}")


def wait_for_app_ready(
    app_name: str,
    profile: str,
    deploy_timeout: int = 600,
    serve_timeout: int = 180,
) -> str:
    """Poll `databricks apps get` until RUNNING, then poll /agent/info until responsive.

    Uses separate timeouts for each phase so a slow deploy doesn't starve the
    serve-readiness check.

    Returns the app URL (without trailing slash).
    """
    # Phase 1: wait for RUNNING state
    deadline = time.time() + deploy_timeout
    app_url = ""
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
                app_url = data.get("url", "").rstrip("/")
                assert app_url, f"No URL found for app {app_name}"
                break
        time.sleep(30)
    else:
        raise TimeoutError(
            f"App {app_name} did not reach RUNNING state within {deploy_timeout}s"
        )

    # Phase 2: poll /agent/info until the app is actually serving
    deadline = time.time() + serve_timeout
    token = get_oauth_token(profile)
    while time.time() < deadline:
        try:
            resp = requests.get(
                f"{app_url}/agent/info",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            if resp.status_code < 500:
                return app_url
        except requests.RequestException:
            pass
        time.sleep(10)

    raise TimeoutError(
        f"App {app_name} is RUNNING but /agent/info did not respond within {serve_timeout}s"
    )


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


def capture_app_logs(app_name: str, profile: str) -> str:
    """Capture app logs via `databricks apps logs`. Returns log output or empty string."""
    try:
        result = subprocess.run(
            ["databricks", "apps", "logs", app_name, "-p", profile],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.stdout if result.returncode == 0 else ""
    except Exception as exc:
        print(f"WARNING: Failed to capture logs for {app_name}: {exc}")
        return ""


def grant_lakebase_access(app_name: str, lakebase: str, profile: str):
    """Grant the app's service principal access to the lakebase instance.

    Best-effort: prints warnings on failure, never raises.
    """
    try:
        result = subprocess.run(
            ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, f"Failed to get app info: {result.stderr}"
        data = json.loads(result.stdout)
        sp_name = data.get("service_principal_name", "")
        assert sp_name, f"No service_principal_name found for app {app_name}"

        client = LakebaseClient(instance_name=lakebase)
        try:
            print(f"Granting lakebase access to SP {sp_name}...")
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
            print(f"Lakebase access granted to {sp_name}.")
        finally:
            client.close()
    except Exception as exc:
        print(f"WARNING: grant_lakebase_access failed for {app_name}: {exc}")


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
