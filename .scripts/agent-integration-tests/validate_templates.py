"""Serial, single-app deploy validation for non-agent templates.

Reuses the deploy/retry/OAuth/log machinery in helpers.py. Each template is
redeployed into ONE shared persistent app via `databricks apps deploy`, then
curl-verified. Run serially — never with pytest -n >0 (shared app).
"""
from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

import pytest
import requests
from helpers import (
    MAX_POLLS,
    POLL_INTERVAL,
    _log,
    _run_cmd,
    _run_with_retries,
    capture_app_logs,
    databricks_create_app,
    get_oauth_token,
    git_copy_template,
    set_log_file,
)
from validate_transforms import resource_aware_app_yaml, parse_spa_assets
from validation_config import DEFAULT_CONFIG_PATH, load_validation_config
from functional_runners import looks_like_login_page, assert_browser_installed

AUTH_DIR = Path(__file__).parent / ".auth"
STORAGE_STATE = AUTH_DIR / "dogfood.json"

BUNDLE_TIMEOUT = 600
QUERY_TIMEOUT = 60
BUILD_TIMEOUT = 1200  # npm ci + npm run build can be slow


def render_report(rows: list[dict]) -> str:
    """Render validation results as a markdown report. Pure function."""
    total = len(rows)
    passed = sum(1 for r in rows if r["outcome"] == "passed")
    failed = sum(1 for r in rows if r["outcome"] == "failed")
    skipped = sum(1 for r in rows if r["outcome"] == "skipped")
    mark = {"passed": "✅ pass", "failed": "❌ FAIL", "skipped": "⏭ skip"}
    lines = [
        "# Template Validation Report",
        "",
        f"**{passed}/{total} passed** — {failed} failed, {skipped} skipped",
        "",
        "| Template | Mode | Verify | Result | Duration |",
        "| --- | --- | --- | --- | --- |",
    ]
    for r in sorted(rows, key=lambda r: (r["outcome"] != "failed", r["template"])):
        lines.append(
            f"| {r['template']} | {r['mode']} | {r['verify']} | "
            f"{mark.get(r['outcome'], r['outcome'])} | {r['duration']:.1f}s |"
        )
    lines.append("")
    return "\n".join(lines)


def prepare_source(template_name: str, dest: Path) -> Path:
    src = git_copy_template(template_name, dest)
    app_yaml = src / "app.yaml"
    if app_yaml.exists():
        # Keep valueFrom refs intact so they resolve against the shared app's
        # bound resources; only strip a source-level resources block.
        app_yaml.write_text(resource_aware_app_yaml(app_yaml.read_text()))
    return src


def build_template(template_name: str, dest: Path) -> None:
    """Build-only validation for SPA/Node templates.

    Copies the template to a throwaway dir (never mutates the real template),
    then runs `npm ci` and `npm run build`, raising on failure. No deploy.
    """
    src = git_copy_template(template_name, dest)
    has_lock = (src / "package-lock.json").exists() or (src / "npm-shrinkwrap.json").exists()
    install_cmd = ["npm", "ci"] if has_lock else ["npm", "install"]
    for cmd in (install_cmd, ["npm", "run", "build"]):
        _log(f"[{template_name}] $ {' '.join(cmd)}")
        result = _run_cmd(cmd, cwd=src, timeout=BUILD_TIMEOUT)
        if result.returncode != 0:
            raise RuntimeError(
                f"{' '.join(cmd)} failed for {template_name}:\n"
                f"stdout: {result.stdout[-2000:]}\nstderr: {result.stderr[-2000:]}"
            )


def sync_source(src_dir: Path, ws_path: str, profile: str) -> None:
    _log(f"Syncing {src_dir.name} -> {ws_path}")
    _run_with_retries(
        ["databricks", "sync", str(src_dir), ws_path, "-p", profile, "--full"],
        cwd=src_dir,
        label="databricks sync",
        timeout=BUNDLE_TIMEOUT,
        recover=lambda stderr, a, m: (time.sleep(POLL_INTERVAL), True)[1] if a < m else False,
    )


def apps_deploy_source(app_name: str, ws_path: str, profile: str) -> None:
    _log(f"Deploying source at {ws_path} into app {app_name}")
    _run_with_retries(
        [
            "databricks", "apps", "deploy", app_name,
            "--source-code-path", ws_path,
            "-p", profile,
        ],
        cwd=Path.cwd(),
        label="apps deploy",
        timeout=BUNDLE_TIMEOUT,
        recover=lambda stderr, a, m: (time.sleep(POLL_INTERVAL), True)[1] if a < m else False,
    )


def wait_for_app_ready_generic(
    app_name: str, profile: str, health_path: str = "/"
) -> tuple[str, str]:
    _log(f"Waiting for app {app_name} to reach RUNNING...")
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
                if not app_url:
                    raise RuntimeError(f"No URL for app {app_name}")
                break
        time.sleep(POLL_INTERVAL)
    else:
        raise TimeoutError(f"App {app_name} not RUNNING within {MAX_POLLS} polls")

    token = get_oauth_token(profile)
    for _ in range(MAX_POLLS):
        try:
            resp = requests.get(
                f"{app_url}{health_path}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            _log(f"  {health_path} status={resp.status_code}")
            if resp.status_code < 500:
                return app_url, token
        except requests.RequestException as exc:
            _log(f"  {health_path} error: {exc}")
        time.sleep(POLL_INTERVAL)
    raise TimeoutError(f"App {app_name} RUNNING but {health_path} not serving")


def health_path_for(verify: str) -> str:
    return "/"


def _browser_load(storage_state: str, url: str) -> tuple[int, str, str]:
    """Load url in a storageState'd browser; return (status, html, final_url)."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(storage_state=storage_state)
        page = ctx.new_page()
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=QUERY_TIMEOUT * 1000)
            status = resp.status if resp else 0
            page.wait_for_timeout(3000)  # let SPA/streamlit frameworks hydrate
            return status, page.content(), page.url
        finally:
            browser.close()


def verify_serving(verify: str, app_url: str, storage_state: str) -> None:
    """Browser-authenticated serve check.

    Deployed apps sit behind SSO: a bearer token GET follows the redirect to a
    200 login page (whose body even contains ``<html``), so a token check
    false-passes. The Apps *front door* also answers before the app *container*
    behind it finishes starting — an unauthenticated token-GET sees the login
    200 (readiness thinks it's up) while an authenticated request reaches the
    still-starting container and 502s. So we drive a real browser carrying the
    saved storageState and retry on 5xx until the container actually serves,
    then assert the app's OWN content rendered (not the login page).
    """
    assert_browser_installed()
    deadline = time.time() + 240  # app container can lag the front door, esp. agents
    status, html, final_url = 0, "", ""
    while True:
        status, html, final_url = _browser_load(storage_state, f"{app_url}/")
        if looks_like_login_page(html, final_url):
            raise RuntimeError(
                "app redirected to SSO login — storageState invalid/expired "
                "(re-run auth_setup.py)"
            )
        if status < 500:
            break
        if time.time() >= deadline:
            raise RuntimeError(f"/ still returning {status} after container-startup wait")
        _log(f"  / returned {status}; app container still starting, retrying…")
        time.sleep(POLL_INTERVAL)

    if verify == "html":
        body = html.lower()
        assert ("<html" in body or "<!doctype" in body) and len(html) > 500, (
            f"/ did not render app content (len={len(html)}): {html[:300]}"
        )
    elif verify == "spa":
        assets = parse_spa_assets(html, app_url)
        assert assets, f"No JS/CSS assets referenced by / (broken build?): {html[:300]}"
    # mcp/api: not-login + non-5xx already asserted above


def _load_cfg(config):
    path = Path(config.getoption("--config") or DEFAULT_CONFIG_PATH)
    return load_validation_config(path, resolve_workspace_root=False)


def pytest_generate_tests(metafunc):
    if "val_template" in metafunc.fixturenames:
        cfg = _load_cfg(metafunc.config)
        templates = cfg.templates
        only = metafunc.config.getoption("--val-template")
        if only:
            templates = [t for t in templates if t.name in only]
        metafunc.parametrize("val_template", templates, ids=lambda t: t.name)


@pytest.fixture(scope="session")
def val_cfg(request):
    path = Path(request.config.getoption("--config") or DEFAULT_CONFIG_PATH)
    return load_validation_config(path)


@pytest.fixture(scope="session")
def shared_app(val_cfg):
    """Ensure the shared persistent app exists (idempotent)."""
    result = _run_cmd(
        ["databricks", "apps", "get", val_cfg.shared_app_name,
         "-p", val_cfg.profile, "--output", "json"],
        timeout=60,
    )
    if result.returncode != 0:
        _log(f"Creating shared app {val_cfg.shared_app_name}")
        databricks_create_app(val_cfg.shared_app_name, val_cfg.profile)
    else:
        _log(f"Shared app {val_cfg.shared_app_name} already exists")
    return val_cfg.shared_app_name


def test_validate_template(val_template, val_cfg, request):
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    set_log_file(log_dir / f"validate-{val_template.name}.log")

    # OBO (on-behalf-of-user) templates can't be exercised in this environment
    # (no user-token forwarding / consent), so they're reported as skipped.
    if val_template.verify == "obo":
        pytest.skip("OBO (on-behalf-of-user) — not testable in this environment")

    # Build-only path: no shared app, no deploy.
    if val_template.verify == "build":
        if request.config.getoption("--val-setup-only"):
            pytest.skip("--val-setup-only: nothing to set up for build-only template")
        with tempfile.TemporaryDirectory(prefix=f"val-{val_template.name}-") as tmp:
            build_template(val_template.name, Path(tmp))
        return

    # Deploy + curl-serve path (html / mcp / api).
    shared_app = request.getfixturevalue("shared_app")
    if request.config.getoption("--val-setup-only"):
        pytest.skip("--val-setup-only: shared app ensured, skipping deploy")

    if not STORAGE_STATE.exists():
        pytest.skip(f"no storageState at {STORAGE_STATE} — run auth_setup.py first")

    ws_path = f"{val_cfg.workspace_source_root}/{val_template.name}"
    with tempfile.TemporaryDirectory(prefix=f"val-{val_template.name}-") as tmp:
        src = prepare_source(val_template.name, Path(tmp))
        sync_source(src, ws_path, val_cfg.profile)
        apps_deploy_source(shared_app, ws_path, val_cfg.profile)
        try:
            app_url, _token = wait_for_app_ready_generic(
                shared_app, val_cfg.profile, health_path_for(val_template.verify)
            )
            verify_serving(val_template.verify, app_url, str(STORAGE_STATE))
        except Exception:
            logs = capture_app_logs(shared_app, val_cfg.profile)
            if logs:
                _log(f"\n--- App logs ({shared_app}) ---\n{logs}\n--- End logs ---")
            raise
