#!/usr/bin/env python3
"""Pre-flight check: start the agent locally, send a test request, verify a response.

Run this before deploying to catch configuration and code errors early.

Usage:
    uv run preflight              # Real deployment preflight; validates configured UC
    uv run preflight --offline-test  # Synthetic local test harness only
"""

import importlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from uuid import uuid4

import mlflow

_IS_WINDOWS = sys.platform == "win32"

# How long to wait for the server to start (seconds)
SERVER_START_TIMEOUT = 60
# How long to wait for a response from the agent (seconds)
REQUEST_TIMEOUT = 60


def verify_agent_tracing() -> dict[str, str]:
    """Import the scaffold and prove its selected autologger executed."""
    tracing = importlib.import_module("agent_server.tracing")
    config = tracing.validate_tracing_environment()
    framework = os.environ.get("AGENT_FRAMEWORK", "")
    importlib.import_module("agent_server.agent")
    if not tracing.selected_autologger_was_called(framework):
        raise RuntimeError(
            f"Tracing preflight failed: selected autologger did not run for {framework!r}"
        )
    return config


def verify_deployment_trace_resources(
    config: dict[str, str],
    *,
    mlflow_client=None,
    workspace_client=None,
) -> None:
    """Prove the configured experiment location and warehouse are available."""
    issues: list[str] = []
    client = mlflow_client or mlflow.MlflowClient()
    experiment = None
    try:
        experiment = client.get_experiment(config["MLFLOW_EXPERIMENT_ID"])
    except Exception as error:
        issues.append(
            f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} is unavailable: {error}"
        )
    if experiment is None:
        issues.append(f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} does not exist")
    else:
        raw_lifecycle = getattr(experiment, "lifecycle_stage", None)
        lifecycle = str(getattr(raw_lifecycle, "value", raw_lifecycle) or "")
        if lifecycle.lower() != "active":
            issues.append(
                f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} is unavailable "
                f"(lifecycle stage: {lifecycle or 'missing'})"
            )
        location = experiment.trace_location
        observed = (
            getattr(location, "catalog_name", None),
            getattr(location, "schema_name", None),
            getattr(location, "table_prefix", None),
            getattr(location, "full_otel_spans_table_name", None),
        )
        expected = (
            config["MLFLOW_UC_CATALOG"],
            config["MLFLOW_UC_SCHEMA"],
            config["MLFLOW_UC_TABLE_PREFIX"],
            config["MLFLOW_OTEL_SPANS_TABLE"],
        )
        if observed != expected:
            issues.append(
                f"experiment {config['MLFLOW_EXPERIMENT_ID']!r} has wrong UC trace "
                f"location {observed!r}; expected {expected!r}"
            )

    if workspace_client is None:
        from databricks.sdk import WorkspaceClient

        workspace_client = WorkspaceClient()
    warehouse_id = config["MLFLOW_TRACING_SQL_WAREHOUSE_ID"]
    try:
        warehouse = workspace_client.warehouses.get(warehouse_id)
        raw_state = getattr(warehouse, "state", None)
        state = str(getattr(raw_state, "value", raw_state) or "")
        if state.upper() in {"DELETED", "DELETING"}:
            issues.append(f"SQL warehouse {warehouse_id!r} is unavailable (state: {state})")
    except Exception as error:
        issues.append(f"SQL warehouse {warehouse_id!r} is unavailable: {error}")

    if issues:
        raise RuntimeError("Deployment tracing preflight failed: " + "; ".join(issues))


def verify_smoke_trace(
    experiment_id: str,
    started_ms: int,
    request_id: str,
    timeout_seconds: float = 15,
) -> str:
    """Prove the exact post-smoke request trace can be searched and retrieved."""
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while True:
        try:
            search_kwargs: dict = {
                "max_results": 100,
                "order_by": ["timestamp_ms DESC"],
                "return_type": "list",
                "include_spans": False,
                "flush": True,
            }
            if mlflow.get_tracking_uri().startswith("databricks"):
                search_kwargs["locations"] = [
                    ".".join(
                        (
                            os.environ["MLFLOW_UC_CATALOG"],
                            os.environ["MLFLOW_UC_SCHEMA"],
                            os.environ["MLFLOW_UC_TABLE_PREFIX"],
                        )
                    )
                ]
            else:
                search_kwargs["locations"] = [experiment_id]
            traces = mlflow.search_traces(**search_kwargs)
            for candidate in traces:
                if candidate.info.timestamp_ms < started_ms:
                    continue
                candidate_request_id = candidate.info.trace_metadata.get(
                    "appkit.request.id"
                )
                if candidate_request_id not in {None, request_id}:
                    continue
                trace_id = candidate.info.trace_id
                retrieved = mlflow.get_trace(trace_id, flush=True)
                if retrieved is None:
                    continue
                metadata_request_id = retrieved.info.trace_metadata.get(
                    "appkit.request.id"
                )
                root_request_ids = {
                    span.get_attribute("appkit.request.id")
                    for span in retrieved.data.spans
                    if span.parent_id is None
                }
                if metadata_request_id == request_id or request_id in root_request_ids:
                    return trace_id
        except Exception as error:
            last_error = error
        if time.monotonic() >= deadline:
            detail = f": {last_error}" if last_error is not None else ""
            raise RuntimeError(
                "Tracing preflight failed: exact smoke trace was not retrievable"
                + detail
            )
        time.sleep(0.5)


def run_offline_test() -> None:
    """Exercise tracing enforcement and retrieval without a live endpoint."""
    with tempfile.TemporaryDirectory(prefix="migration-preflight-") as directory:
        tracking_uri = f"sqlite:///{os.path.join(directory, 'mlflow.db')}"
        artifact_dir = Path(directory) / "artifacts"
        artifact_dir.mkdir()
        mlflow.set_tracking_uri(tracking_uri)
        experiment_id = mlflow.MlflowClient().create_experiment(
            "migration-offline-preflight",
            artifact_location=artifact_dir.as_uri(),
        )
        mlflow.set_experiment(experiment_id=experiment_id)
        os.environ.update(
            {
                "MLFLOW_TRACKING_URI": tracking_uri,
                "MLFLOW_EXPERIMENT_ID": experiment_id,
                "MLFLOW_TRACING_SQL_WAREHOUSE_ID": "0123456789abcdef",
                "MLFLOW_UC_CATALOG": "offline_catalog",
                "MLFLOW_UC_SCHEMA": "offline_schema",
                "MLFLOW_UC_TABLE_PREFIX": "offline_migration",
                "MLFLOW_OTEL_SPANS_TABLE": (
                    "offline_catalog.offline_schema.offline_migration_otel_spans"
                ),
            }
        )

        verify_agent_tracing()
        framework = os.environ["AGENT_FRAMEWORK"]
        print(f"selected autologger ran: {framework}")

        request_id = f"offline-smoke-{uuid4()}"
        started_ms = int(time.time() * 1000)
        with mlflow.start_span(name="preflight.smoke", span_type="AGENT") as span:
            mlflow.update_current_trace(
                metadata={"appkit.request.id": request_id}
            )
            span.set_inputs({"offline": True, "framework": framework})
            span.set_outputs({"tracing": "enabled"})
            span.set_status("OK")
        trace_id = verify_smoke_trace(
            experiment_id=experiment_id,
            started_ms=started_ms,
            request_id=request_id,
        )
        print(f"smoke trace retrieved: {trace_id}")


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


def check_invocations(base_url: str, request_id: str, retries: int = 2) -> bool:
    payload = json.dumps(
        {
            "input": [{"role": "user", "content": "Say hello in one word."}],
            "custom_inputs": {"request_id": request_id},
        }
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
    if "--offline-test" in sys.argv[1:]:
        print(
            "TEST-ONLY: synthetic local tracing configuration; "
            "deployment UC validation is not performed"
        )
        run_offline_test()
        return

    print("Pre-flight check")
    print("=" * 40)

    config = verify_agent_tracing()
    verify_deployment_trace_resources(config)

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
        smoke_request_id = f"preflight-smoke-{uuid4()}"
        smoke_started_ms = int(time.time() * 1000)
        if not check_invocations(base_url, request_id=smoke_request_id):
            print("   FAILED")
            sys.exit(1)
        print("   OK")

        # Step 4: Prove the smoke request exported a retrievable trace.
        print("4. Retrieving smoke trace...")
        trace_id = verify_smoke_trace(
            experiment_id=config["MLFLOW_EXPERIMENT_ID"],
            started_ms=smoke_started_ms,
            request_id=smoke_request_id,
        )
        print(f"   OK ({trace_id})")

        print("=" * 40)
        print("Pre-flight check passed!")

    finally:
        stop_server(proc)


if __name__ == "__main__":
    main()
