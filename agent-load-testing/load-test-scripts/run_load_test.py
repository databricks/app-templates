#!/usr/bin/env python3
"""
Run Locust load tests against Databricks Apps agent endpoints.

Loops through a list of app URLs sequentially, running a ramp-to-saturation
load test on each. Shows live progress with current user count, QPS, latency,
and failure rate. Optionally generates an interactive HTML dashboard.

Usage:
    # Single app with M2M OAuth (recommended for long/overnight runs):
    python run_load_test.py \
        --app-url https://agent-load-test-medium-w2-123.aws.databricksapps.com \
        --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET>

    # Or set credentials as env vars:
    export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
    export DATABRICKS_CLIENT_ID=<CLIENT_ID>
    export DATABRICKS_CLIENT_SECRET=<CLIENT_SECRET>
    python run_load_test.py --app-url https://your-app.aws.databricksapps.com

    # Multiple apps sequentially:
    python run_load_test.py \
        --app-url https://agent-load-test-medium-w2-123.aws.databricksapps.com \
        --app-url https://agent-load-test-medium-w4-123.aws.databricksapps.com \
        --app-url https://agent-load-test-large-w8-123.aws.databricksapps.com

    # With dashboard and labels:
    python run_load_test.py \
        --app-url https://my-app-medium-w4.aws.databricksapps.com \
        --app-url https://my-app-large-w8.aws.databricksapps.com \
        --label medium-4w --label large-8w \
        --dashboard

    # If no --app-url is provided, uses DEFAULT_APP_URLS below as fallback.

    # Skip healthcheck/warmup:
    python run_load_test.py \
        --app-url https://my-app.aws.databricksapps.com \
        --skip-healthcheck --skip-warmup

Environment (M2M OAuth — recommended for long/overnight runs):
    DATABRICKS_HOST: Workspace URL
    DATABRICKS_CLIENT_ID: Service principal client ID
    DATABRICKS_CLIENT_SECRET: Service principal client secret

  Or (will expire during long tests):
    DATABRICKS_TOKEN: Static auth token
    DATABRICKS_HOST: Workspace URL for CLI token refresh
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import requests as http_requests


SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent  # agent-load-testing/
LOCUSTFILE = SCRIPT_DIR / "locustfile.py"
RUNS_DIR = PROJECT_DIR / "load-test-runs"

# Use python3 -m locust in case locust isn't on PATH
LOCUST_CMD = [sys.executable, "-m", "locust"]

# ──────────────────────────────────────────────────────────────────────────────
# Default app URLs — edit this list to load test your apps without passing
# --app-url on the command line. Each entry is (url, label).
# Uncomment the apps you want to test:
# ──────────────────────────────────────────────────────────────────────────────
DEFAULT_APP_URLS: list[tuple[str, str]] = [
    # ("https://my-app-medium-w2-12345.aws.databricksapps.com", "medium-2w"),
    # ("https://my-app-medium-w4-12345.aws.databricksapps.com", "medium-4w"),
    # ("https://my-app-large-w8-12345.aws.databricksapps.com",  "large-8w"),
]


def get_m2m_token(host: str, client_id: str, client_secret: str) -> tuple[str, int]:
    """Exchange client credentials for an access token via M2M OAuth.

    Returns (access_token, expires_in_seconds).
    """
    resp = http_requests.post(
        f"{host.rstrip('/')}/oidc/v1/token",
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "all-apis",
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["access_token"], data.get("expires_in", 3600)


def get_token(host: str, client_id: str = None, client_secret: str = None) -> str:
    """Get a Databricks auth token. Tries M2M OAuth first, then static token, then CLI."""
    # 1. M2M OAuth
    if client_id and client_secret and host:
        token, _ = get_m2m_token(host, client_id, client_secret)
        return token

    # 2. Static token
    env_token = os.environ.get("DATABRICKS_TOKEN")
    if env_token:
        return env_token

    # 3. CLI fallback
    if not host:
        print("ERROR: No authentication method available.")
        print("  Set --client-id/--client-secret (recommended), DATABRICKS_TOKEN, or DATABRICKS_HOST.")
        sys.exit(1)

    result = subprocess.run(
        ["databricks", "auth", "token", "--host", host],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  ERROR: Failed to get auth token for {host}")
        print(f"  stderr: {result.stderr.strip()}")
        sys.exit(1)

    data = json.loads(result.stdout)
    return data["access_token"]


def refresh_token(host: str = None, client_id: str = None, client_secret: str = None) -> str | None:
    """Refresh the auth token. Returns new token or None on failure."""
    # M2M OAuth — always works, no expiry issues
    if client_id and client_secret and host:
        try:
            token, _ = get_m2m_token(host, client_id, client_secret)
            return token
        except Exception:
            pass
        return None

    # CLI fallback
    if not host:
        return None
    try:
        result = subprocess.run(
            ["databricks", "auth", "token", "--host", host],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            return data["access_token"]
    except Exception:
        pass
    return None


def detect_compute_size(app_url: str, token: str) -> str | None:
    """Auto-detect compute size from Databricks app metadata.

    Extracts the app name from the URL and calls `databricks apps get` to read
    the compute size (e.g., 'Small', 'Medium', 'Large').
    Returns lowercase size string, or None if detection fails.
    """
    try:
        # Extract app name from URL: https://<app-name>-<hash>.aws.databricksapps.com
        # The app name is everything before the last hyphen-hash segment
        hostname = app_url.split("//")[1].split(".")[0] if "//" in app_url else ""
        if not hostname:
            return None

        # Extract workspace host from DATABRICKS_HOST env var
        host = os.environ.get("DATABRICKS_HOST", "")
        if not host:
            return None

        # Use the Databricks CLI to get app info
        result = subprocess.run(
            ["databricks", "apps", "get", hostname, "--host", host, "--output", "json"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode == 0:
            app_info = json.loads(result.stdout)
            # compute_size is in the app's compute config
            compute = app_info.get("compute", {})
            size = compute.get("size", "").lower()
            if size:
                return size
    except Exception:
        pass
    return None


def healthcheck(app_url: str, token: str, retries: int = 15, delay: int = 20) -> bool:
    """Verify the app streams correctly (receives [DONE]) before load testing."""
    print(f"  Streaming healthcheck...", end="", flush=True)
    for attempt in range(1, retries + 1):
        try:
            result = subprocess.run(
                [
                    "curl", "-sN", "-X", "POST", f"{app_url}/invocations",
                    "-H", f"Authorization: Bearer {token}",
                    "-H", "Content-Type: application/json",
                    "-d", '{"input":[{"role":"user","content":"What time is it?"}],"stream":true}',
                    "--max-time", "30",
                ],
                capture_output=True,
                text=True,
                timeout=45,
            )
            if "[DONE]" in result.stdout:
                print(f" passed (attempt {attempt})")
                return True
            else:
                print(f" attempt {attempt}/{retries} failed", end="", flush=True)
        except (subprocess.TimeoutExpired, Exception) as e:
            print(f" attempt {attempt}/{retries} error: {e}", end="", flush=True)

        if attempt < retries:
            time.sleep(delay)
    print(f" FAILED after {retries} attempts")
    return False


def warmup(app_url: str, token: str, num_requests: int = 10):
    """Send sequential warmup requests."""
    print(f"  Warmup ({num_requests} requests)...", end="", flush=True)
    for i in range(num_requests):
        try:
            subprocess.run(
                [
                    "curl", "-s", "-X", "POST", f"{app_url}/invocations",
                    "-H", f"Authorization: Bearer {token}",
                    "-H", "Content-Type: application/json",
                    "-d", '{"input":[{"role":"user","content":"warmup"}]}',
                    "--max-time", "30",
                    "-o", "/dev/null",
                ],
                capture_output=True,
                timeout=45,
            )
        except Exception:
            pass
    print(" done")


def monitor_progress(history_file: Path, label: str, max_users: int, step_duration: int, stop_event: threading.Event):
    """Monitor the locust stats history file and print live progress."""
    last_line_count = 0
    last_users = 0
    start_time = time.time()

    while not stop_event.is_set():
        stop_event.wait(5)  # Check every 5 seconds
        if not history_file.exists():
            continue

        try:
            with open(history_file) as f:
                reader = csv.DictReader(f)
                rows = list(reader)

            if not rows:
                continue

            # Get latest aggregated row
            agg_rows = [r for r in rows if r.get("Name") == "Aggregated"]
            if not agg_rows:
                continue

            latest = agg_rows[-1]
            users = int(latest.get("User Count", 0))
            qps = float(latest.get("Requests/s", 0))
            fail_s = float(latest.get("Failures/s", 0))
            p50 = latest.get("50%", "N/A")
            p95 = latest.get("95%", "N/A")
            p99 = latest.get("99%", "N/A")

            # Get stream-specific data if available
            stream_rows = [r for r in rows if r.get("Name") == "/invocations (stream)"]
            total_reqs = 0
            total_fails = 0
            if stream_rows:
                sr = stream_rows[-1]
                total_reqs = int(sr.get("Total Request Count", 0))
                total_fails = int(sr.get("Total Failure Count", 0))
                qps = float(sr.get("Requests/s", 0))

            elapsed = time.time() - start_time
            elapsed_str = f"{int(elapsed//60)}m{int(elapsed%60):02d}s"
            fail_pct = (total_fails / total_reqs * 100) if total_reqs > 0 else 0

            # Progress bar
            progress = min(users / max_users, 1.0)
            bar_len = 20
            filled = int(bar_len * progress)
            bar = "█" * filled + "░" * (bar_len - filled)

            print(
                f"\r  [{bar}] {users:>3}/{max_users} users | "
                f"QPS: {qps:>6.1f} | "
                f"p50: {p50:>5}ms | p95: {p95:>5}ms | "
                f"Reqs: {total_reqs:>6,} | "
                f"Fail: {fail_pct:.1f}% | "
                f"{elapsed_str}",
                end="",
                flush=True,
            )

            if users != last_users and users > last_users:
                last_users = users

        except Exception:
            pass  # File may be mid-write

    print()  # Final newline


def run_load_test(
    app_url: str,
    token: str,
    label: str,
    output_dir: Path,
    max_users: int = 500,
    step_size: int = 20,
    step_duration: int = 45,
    spawn_rate: int = 20,
) -> dict:
    """Run a single Locust load test with live progress monitoring. Returns summary dict."""
    output_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["DATABRICKS_TOKEN"] = token
    env["STEP_SIZE"] = str(step_size)
    env["STEP_DURATION"] = str(step_duration)
    env["MAX_USERS"] = str(max_users)
    env["SPAWN_RATE"] = str(spawn_rate)

    num_steps = max_users // step_size
    total_duration = num_steps * step_duration
    total_min = total_duration / 60

    print(f"  Ramp: {step_size} users/step, {step_duration}s/step, "
          f"max {max_users} users ({num_steps} steps, ~{total_min:.0f} min)")

    csv_prefix = output_dir / "results"
    history_file = output_dir / "results_stats_history.csv"
    log_file = output_dir / "locust_output.log"

    cmd = LOCUST_CMD + [
        "-f", str(LOCUSTFILE),
        "--host", app_url,
        "--headless",
        "--csv", str(csv_prefix),
        "--html", str(output_dir / "report.html"),
    ]

    # Start locust subprocess
    with open(log_file, "w") as lf:
        proc = subprocess.Popen(cmd, env=env, cwd=str(SCRIPT_DIR), stdout=lf, stderr=lf)

    # Start progress monitor in background thread
    stop_event = threading.Event()
    monitor_thread = threading.Thread(
        target=monitor_progress,
        args=(history_file, label, max_users, step_duration, stop_event),
        daemon=True,
    )
    monitor_thread.start()

    # Wait for locust to finish
    proc.wait()

    # Stop monitor
    stop_event.set()
    monitor_thread.join(timeout=5)

    # Parse and return summary
    stats_file = output_dir / "results_stats.csv"
    summary = parse_summary(stats_file, label)
    return summary


def parse_summary(stats_file: Path, label: str) -> dict:
    """Parse results_stats.csv and return summary dict."""
    summary = {"label": label, "status": "NO_RESULTS"}

    if not stats_file.exists():
        return summary

    with open(stats_file) as f:
        rows = list(csv.DictReader(f))

    stream_rows = [r for r in rows if r["Name"] == "/invocations (stream)"]
    ttft_rows = [r for r in rows if r["Name"] == "TTFT"]

    if stream_rows:
        r = stream_rows[0]
        total = int(r["Request Count"])
        fails = int(r["Failure Count"])
        summary.update({
            "status": "OK",
            "total_requests": total,
            "failures": fails,
            "fail_pct": (fails / total * 100) if total else 0,
            "qps": float(r["Requests/s"]),
            "p50": r["50%"],
            "p95": r["95%"],
            "p99": r["99%"],
        })

    if ttft_rows:
        r = ttft_rows[0]
        summary.update({
            "ttft_p50": r["50%"],
            "ttft_p95": r["95%"],
            "ttft_p99": r["99%"],
        })

    return summary


def print_summary_table(results: list[dict]):
    """Print a formatted summary table of all test results."""
    print(f"\n{'='*90}")
    print(f"  LOAD TEST RESULTS SUMMARY")
    print(f"{'='*90}")
    print(f"  {'Label':<25} {'QPS':>6} {'Reqs':>8} {'Fail%':>7} {'p50':>6} {'p95':>6} {'p99':>6} {'TTFT p50':>9}")
    print(f"  {'-'*25} {'-'*6} {'-'*8} {'-'*7} {'-'*6} {'-'*6} {'-'*6} {'-'*9}")

    for r in results:
        if r["status"] == "OK":
            print(
                f"  {r['label']:<25} "
                f"{r['qps']:>6.1f} "
                f"{r['total_requests']:>8,} "
                f"{r['fail_pct']:>6.1f}% "
                f"{r['p50']:>5}ms "
                f"{r['p95']:>5}ms "
                f"{r['p99']:>5}ms "
                f"{r.get('ttft_p50', 'N/A'):>8}ms"
            )
        elif r["status"] == "SKIPPED":
            print(f"  {r['label']:<25} {'SKIPPED':>6} — {r.get('reason', 'healthcheck failed')}")
        else:
            print(f"  {r['label']:<25} {'NO RESULTS':>6}")

    print(f"{'='*90}")


def main():
    parser = argparse.ArgumentParser(
        description="Run Locust load tests against Databricks Apps agent endpoints.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # M2M OAuth (recommended — tokens auto-refresh, works for overnight runs):
  python run_load_test.py \\
      --app-url https://my-app.aws.databricksapps.com \\
      --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> \\
      --dashboard

  # Or use env vars for credentials:
  export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
  export DATABRICKS_CLIENT_ID=<CLIENT_ID>
  export DATABRICKS_CLIENT_SECRET=<CLIENT_SECRET>
  python run_load_test.py --app-url https://my-app.aws.databricksapps.com --dashboard

  # Multiple apps with labels:
  python run_load_test.py \\
      --app-url https://app-medium-w4.aws.databricksapps.com --label medium-4w \\
      --app-url https://app-large-w8.aws.databricksapps.com  --label large-8w \\
      --dashboard

  # Use DEFAULT_APP_URLS (edit the list in this file):
  python run_load_test.py --dashboard

  # Custom ramp:
  python run_load_test.py --app-url https://my-app.aws.databricksapps.com \\
      --max-users 300 --step-size 10 --step-duration 60
        """,
    )

    parser.add_argument(
        "--app-url", action="append", default=None,
        help="Databricks App URL to load test (repeatable). Falls back to DEFAULT_APP_URLS if omitted.",
    )
    parser.add_argument(
        "--label", action="append", default=None,
        help="Human-readable label for each --app-url (same order). Auto-derived from URL if omitted.",
    )
    parser.add_argument("--max-users", type=int, default=500, help="Max concurrent users (default: 500)")
    parser.add_argument("--step-size", type=int, default=20, help="Users added per step (default: 20)")
    parser.add_argument("--step-duration", type=int, default=45, help="Seconds per step (default: 45)")
    parser.add_argument("--spawn-rate", type=int, default=20, help="User spawn rate/sec (default: 20)")
    parser.add_argument("--run-name", type=str, default=None, help="Name for this test run (default: <timestamp>). Results saved to results/<run-name>/.")
    parser.add_argument(
        "--client-id", type=str, default=None,
        help="Service principal client ID for M2M OAuth (recommended for long tests). "
             "Also reads from DATABRICKS_CLIENT_ID env var.",
    )
    parser.add_argument(
        "--client-secret", type=str, default=None,
        help="Service principal client secret for M2M OAuth. "
             "Also reads from DATABRICKS_CLIENT_SECRET env var.",
    )
    parser.add_argument("--skip-healthcheck", action="store_true", help="Skip streaming healthcheck")
    parser.add_argument("--skip-warmup", action="store_true", help="Skip warmup requests")
    parser.add_argument("--dashboard", action="store_true", help="Generate interactive HTML dashboard after tests")
    parser.add_argument(
        "--mock-chunk-delay-ms", type=int, default=None,
        help="Mock agent chunk delay in ms (metadata for dashboard display)",
    )
    parser.add_argument(
        "--mock-chunk-count", type=int, default=None,
        help="Mock agent chunk count (metadata for dashboard display)",
    )
    parser.add_argument(
        "--compute-size", action="append", default=None,
        help="Compute size for each --app-url (repeatable: medium, large). "
             "Default: auto-detected from Databricks app metadata, or 'medium' if unavailable.",
    )

    args = parser.parse_args()

    # Resolve app URLs: CLI args take priority, then DEFAULT_APP_URLS fallback
    if args.app_url:
        app_urls = [u.rstrip("/") for u in args.app_url]
        # Auto-derive labels from URLs if not provided
        if args.label:
            url_labels = list(args.label)
        else:
            url_labels = []
        while len(url_labels) < len(app_urls):
            url = app_urls[len(url_labels)]
            auto_label = url.split("//")[1].split(".")[0] if "//" in url else f"app_{len(url_labels)}"
            url_labels.append(auto_label)
    elif DEFAULT_APP_URLS:
        app_urls = [u.rstrip("/") for u, _ in DEFAULT_APP_URLS]
        url_labels = [lbl for _, lbl in DEFAULT_APP_URLS]
        print("Using DEFAULT_APP_URLS (no --app-url provided)")
    else:
        print("ERROR: No --app-url provided and DEFAULT_APP_URLS is empty.")
        print("  Either pass --app-url or edit DEFAULT_APP_URLS in run_load_test.py")
        sys.exit(1)

    # Resolve compute sizes: CLI flag > auto-detect > default "medium"
    compute_sizes = list(args.compute_size) if args.compute_size else []
    if len(compute_sizes) < len(app_urls):
        # Try auto-detecting for missing entries
        temp_token = os.environ.get("DATABRICKS_TOKEN")
        for i in range(len(compute_sizes), len(app_urls)):
            detected = detect_compute_size(app_urls[i], temp_token or "")
            if detected:
                print(f"  Auto-detected compute size for {url_labels[i]}: {detected}")
                compute_sizes.append(detected)
            else:
                compute_sizes.append("medium")

    # Prefix labels with compute size if not already prefixed
    for i, label in enumerate(url_labels):
        size = compute_sizes[i].lower()
        # Only add prefix if the label doesn't already start with a compute size
        if not any(label.lower().startswith(s) for s in ["small", "medium", "large", "xlarge"]):
            url_labels[i] = f"{size}_{label}"

    # Resolve output directory: load-test-runs/<run_name>/
    run_name = args.run_name or time.strftime("%Y%m%d_%H%M%S")
    base_output = RUNS_DIR / run_name

    # Resolve auth credentials — M2M OAuth is preferred for long-running tests
    client_id = args.client_id or os.environ.get("DATABRICKS_CLIENT_ID")
    client_secret = args.client_secret or os.environ.get("DATABRICKS_CLIENT_SECRET")
    host = os.environ.get("DATABRICKS_HOST", "").rstrip("/")

    if client_id and client_secret:
        if not host:
            print("ERROR: DATABRICKS_HOST is required when using --client-id/--client-secret.")
            sys.exit(1)
        auth_method = "M2M OAuth (service principal)"
    elif os.environ.get("DATABRICKS_TOKEN"):
        auth_method = "static token (WARNING: may expire during long tests)"
    elif host:
        auth_method = "CLI (WARNING: U2M tokens may expire during long tests)"
    else:
        print("ERROR: No authentication method available.")
        print("  Recommended: --client-id <ID> --client-secret <SECRET> (M2M OAuth)")
        print("  Or set: DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET + DATABRICKS_HOST")
        print("  Or set: DATABRICKS_TOKEN (static, may expire)")
        sys.exit(1)

    print(f"  Auth: {auth_method}")
    token = get_token(host, client_id, client_secret)

    # Pass M2M credentials to Locust subprocess via env vars so it can auto-refresh
    if client_id and client_secret:
        os.environ["DATABRICKS_CLIENT_ID"] = client_id
        os.environ["DATABRICKS_CLIENT_SECRET"] = client_secret
        if host:
            os.environ["DATABRICKS_HOST"] = host

    num_steps = args.max_users // args.step_size
    test_min = num_steps * args.step_duration / 60
    total_min = test_min * len(app_urls)

    print(f"╔{'═'*58}╗")
    print(f"║  Databricks Apps Load Test                               ║")
    print(f"╠{'═'*58}╣")
    print(f"║  Apps:          {len(app_urls):<41}║")
    print(f"║  Ramp:          {args.step_size} users/step, {args.step_duration}s/step{' '*(22 - len(str(args.step_size)) - len(str(args.step_duration)))}║")
    print(f"║  Max users:     {args.max_users:<41}║")
    print(f"║  Per-test time: ~{test_min:.0f} min{' '*(37 - len(f'{test_min:.0f}'))}║")
    print(f"║  Total time:    ~{total_min:.0f} min{' '*(37 - len(f'{total_min:.0f}'))}║")
    print(f"║  Output:        {str(base_output)[:41]:<41}║")
    if args.dashboard:
        print(f"║  Dashboard:     {str(base_output / 'dashboard.html')[:41]:<41}║")
    print(f"╚{'═'*58}╝")

    # Save test config so the dashboard can read it later
    test_config = {
        "max_users": args.max_users,
        "step_size": args.step_size,
        "step_duration": args.step_duration,
        "spawn_rate": args.spawn_rate,
        "app_urls": app_urls,
        "labels": url_labels,
        "compute_sizes": compute_sizes,
    }
    if args.mock_chunk_delay_ms:
        test_config["mock_chunk_delay_ms"] = args.mock_chunk_delay_ms
    if args.mock_chunk_count:
        test_config["mock_chunk_count"] = args.mock_chunk_count

    base_output.mkdir(parents=True, exist_ok=True)
    config_path = base_output / "test_config.json"
    config_path.write_text(json.dumps(test_config, indent=2))
    print(f"  Test config saved to {config_path}")

    results = []

    for i, app_url in enumerate(app_urls):
        label = url_labels[i]
        output_dir = base_output / label

        print(f"\n{'─'*60}")
        print(f"  [{i+1}/{len(app_urls)}] {label}")
        print(f"  {app_url}")
        print(f"{'─'*60}")

        # Refresh token before each app (M2M OAuth auto-refreshes; CLI may expire)
        new_token = refresh_token(host, client_id, client_secret)
        if new_token:
            token = new_token

        # Healthcheck
        if not args.skip_healthcheck:
            if not healthcheck(app_url, token):
                print(f"  SKIPPING — healthcheck failed")
                results.append({"label": label, "status": "SKIPPED", "reason": "healthcheck failed"})
                continue

        # Warmup
        if not args.skip_warmup:
            warmup(app_url, token)

        # Run load test with live progress
        summary = run_load_test(
            app_url=app_url,
            token=token,
            label=label,
            output_dir=output_dir,
            max_users=args.max_users,
            step_size=args.step_size,
            step_duration=args.step_duration,
            spawn_rate=args.spawn_rate,
        )
        results.append(summary)

        # Print individual result
        if summary["status"] == "OK":
            print(f"\n  ✓ {label}: QPS={summary['qps']:.1f} | "
                  f"p50={summary['p50']}ms | p95={summary['p95']}ms | "
                  f"Fail={summary['fail_pct']:.1f}%")
        print(f"  Results: {output_dir}/")

    # Final summary table
    print_summary_table(results)
    print(f"\nAll results saved to {base_output}/")

    # Generate dashboard if requested
    if args.dashboard:
        from dashboard_template import generate_dashboard

        print(f"\nGenerating dashboard...")
        dashboard_path = generate_dashboard(
            results=results,
            output_dir=base_output,
            app_urls=app_urls,
            labels=url_labels,
            metadata=test_config,
        )
        if dashboard_path:
            print(f"Dashboard: {dashboard_path}")
            print(f"  open {dashboard_path}")


if __name__ == "__main__":
    main()
