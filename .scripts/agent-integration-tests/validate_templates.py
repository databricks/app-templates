"""Serial, single-app deploy validation for non-agent templates.

Reuses the deploy/retry/OAuth/log machinery in helpers.py. Each template is
redeployed into ONE shared persistent app via `databricks apps deploy`, then
curl-verified. Run serially — never with pytest -n >0 (shared app).
"""
from __future__ import annotations

import html
import json
import os
import re
import subprocess
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


CHATBOT_UI_TEMPLATE = "e2e-chatbot-app-next"


def chatbot_ui_dir(template_name: str, src: Path) -> str | None:
    """Where a template looks for the chatbot UI before cloning it from GitHub
    main at startup, or None if it doesn't consume the chatbot UI. Python agents'
    scripts/start_app.py reuses ./e2e-chatbot-app-next; agent-langchain-ts's
    scripts/setup-ui.sh reuses ./ui."""
    if (src / "scripts" / "start_app.py").exists():
        return CHATBOT_UI_TEMPLATE
    if template_name == "agent-langchain-ts":
        return "ui"
    return None


def prepare_source(template_name: str, dest: Path, bundle_chatbot_ui: bool = False) -> Path:
    src = git_copy_template(template_name, dest)
    app_yaml = src / "app.yaml"
    if app_yaml.exists():
        # Keep valueFrom refs intact so they resolve against the shared app's
        # bound resources; only strip a source-level resources block.
        app_yaml.write_text(resource_aware_app_yaml(app_yaml.read_text()))
    # --val-bundle-chatbot-ui: consumers clone the chatbot UI from GitHub main
    # at startup, so a deploy would test main's UI, not this checkout's. Vendor
    # this checkout's copy where they look first, so they skip the clone.
    ui_dir = chatbot_ui_dir(template_name, src) if bundle_chatbot_ui else None
    if ui_dir:
        git_copy_template(CHATBOT_UI_TEMPLATE, src)
        if ui_dir != CHATBOT_UI_TEMPLATE:
            (src / CHATBOT_UI_TEMPLATE).rename(src / ui_dir)
        # `databricks sync` skips gitignored paths, and agent-langchain-ts
        # ignores /ui; un-ignore it in the copy or the vendored UI never uploads.
        gitignore = src / ".gitignore"
        if gitignore.exists():
            ignored = {ui_dir, f"/{ui_dir}", f"{ui_dir}/", f"/{ui_dir}/"}
            lines = gitignore.read_text().splitlines()
            gitignore.write_text("\n".join(l for l in lines if l.strip() not in ignored) + "\n")
        _log(f"[{template_name}] bundled this checkout's {CHATBOT_UI_TEMPLATE} as ./{ui_dir}")
    return src


def apply_replacements(src: Path, replace: tuple[tuple[str, str], ...]) -> int:
    """Apply a template's configured `replace` pairs to every text file in its
    copied source (never lockfiles). Returns the number of files changed."""
    if not replace:
        return 0
    changed = 0
    for f in sorted(p for p in src.rglob("*") if p.is_file()):
        if f.name == "package-lock.json":
            continue
        try:
            text = f.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        new = text
        for old, repl in replace:
            new = new.replace(old, repl)
        if new != text:
            f.write_text(new)
            changed += 1
    return changed


def build_template(template_name: str, dest: Path, extra_env: dict | None = None) -> None:
    """Build-only validation for SPA/Node templates.

    Copies the template to a throwaway dir (never mutates the real template),
    then runs `npm ci` and `npm run build`, raising on failure. No deploy.
    """
    src = git_copy_template(template_name, dest)
    # Route npm through the Databricks proxy — registry.npmjs.org is frequently
    # 503/unreachable from this environment.
    env = {**os.environ, "npm_config_registry": "https://npm-proxy.cloud.databricks.com",
           **(extra_env or {})}
    has_lock = (src / "package-lock.json").exists() or (src / "npm-shrinkwrap.json").exists()
    install_cmd = ["npm", "ci"] if has_lock else ["npm", "install"]
    for cmd in (install_cmd, ["npm", "run", "build"]):
        _log(f"[{template_name}] $ {' '.join(cmd)}")
        result = _run_cmd(cmd, cwd=src, env=env, timeout=BUILD_TIMEOUT)
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


# A failed platform build (npm/pip install, `npm run build`) or a crash on start
# is deterministic: retry once for a transient blip, not the full retry budget.
DETERMINISTIC_FAILURE_MARKERS = ("Error building app", "app exited unexpectedly")
BUILD_FAILED_MAX_ATTEMPTS = 2


def _deploy_recover(stderr: str, attempt: int, max_attempts: int) -> bool:
    if any(m in stderr for m in DETERMINISTIC_FAILURE_MARKERS) and attempt >= BUILD_FAILED_MAX_ATTEMPTS:
        return False
    if attempt >= max_attempts:
        return False
    time.sleep(POLL_INTERVAL)
    return True


def build_log_entries(logz_html: str, limit: int = 60, sources: tuple = ("BUILD",)) -> list[str]:
    """Extract the given-source rows (BUILD/APP/SYSTEM) from /logz, oldest first."""
    pattern = r'<tr class="log-entry" data-source="(?:%s)">(.*?)</tr>' % "|".join(sources)
    rows = re.findall(pattern, logz_html, re.S)
    entries = []
    for row in rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        text = html.unescape(re.sub(r"<[^>]+>", "", cells[-1] if cells else row)).strip()
        if text:
            entries.append(text)
    return list(reversed(entries[:limit]))  # page lists newest first


def _log_build_failure(app_name: str, profile: str, sources: tuple = ("BUILD", "APP", "SYSTEM")) -> None:
    """Log the app's build/runtime output — `databricks apps logs` is SSO-walled here."""
    _, url, _ = _apps_status(app_name, profile)
    if not url or not STORAGE_STATE.exists():
        return
    try:
        _, logz, _ = _browser_load(str(STORAGE_STATE), f"{url}/logz")
    except Exception as e:  # diagnostics only; never mask the deploy failure
        _log(f"(could not read {url}/logz: {e})")
        return
    entries = build_log_entries(logz, sources=sources)
    _log("\n--- App logs (/logz) ---\n" + "\n".join(entries) + "\n--- End logs ---")


def apps_deploy_source(app_name: str, ws_path: str, profile: str) -> None:
    _log(f"Deploying source at {ws_path} into app {app_name}")
    try:
        _run_with_retries(
            [
                "databricks", "apps", "deploy", app_name,
                "--source-code-path", ws_path,
                "-p", profile,
            ],
            cwd=Path.cwd(),
            label="apps deploy",
            timeout=BUNDLE_TIMEOUT,
            recover=_deploy_recover,
        )
    except Exception:
        _log_build_failure(app_name, profile)
        raise


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


def assert_html_rendered(html: str, expect) -> None:
    """Assert the served page is real app content, not a shell/error/404 page.

    Pure (no browser) so it is unit-testable. Beyond the baseline ``<html>`` +
    length check, every string in ``expect`` must appear in the (hydrated) DOM —
    an app-specific signal that a generic framework shell or error page lacks.
    """
    body = html.lower()
    assert ("<html" in body or "<!doctype" in body) and len(html) > 500, (
        f"/ did not render HTML (len={len(html)}): {html[:300]}"
    )
    missing = [s for s in expect if s.lower() not in body]
    assert not missing, (
        f"/ served HTML but expected app content {missing} not found "
        f"(generic shell / error page / wrong app?); got: {html[:300]}"
    )


def _browser_load(storage_state: str, url: str, expect=(), click=None) -> tuple[int, str, str]:
    """Load url in a storageState'd browser; return (status, html, final_url).

    When ``expect`` is given, wait (best effort) for that text to render instead
    of a fixed sleep, so slow SPA/streamlit hydration doesn't cause a false fail;
    the authoritative check is ``assert_html_rendered`` on the returned html.

    When ``click`` is given (an obo app that runs its downstream call on
    interaction, not on load), click the control with that accessible name/text
    after the page settles, then wait for ``expect`` — so the success signal is
    the result of the user-triggered, forwarded-token call.
    """
    import contextlib

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(storage_state=storage_state)
        page = ctx.new_page()
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=QUERY_TIMEOUT * 1000)
            status = resp.status if resp else 0
            if status < 500 and click:
                page.wait_for_timeout(3000)  # let the control mount
                with contextlib.suppress(Exception):
                    btn = page.get_by_role("button", name=click)
                    (btn.first if btn.count() else page.get_by_text(click, exact=False).first).click(
                        timeout=QUERY_TIMEOUT * 1000
                    )
            if status < 500 and expect:
                for text in expect:
                    with contextlib.suppress(Exception):
                        page.get_by_text(text, exact=False).first.wait_for(
                            timeout=QUERY_TIMEOUT * 1000
                        )
            else:
                page.wait_for_timeout(3000)  # let SPA/streamlit frameworks hydrate
            return status, page.content(), page.url
        finally:
            browser.close()


def verify_serving(verify: str, app_url: str, storage_state: str, expect=(), click=None) -> None:
    """Browser-authenticated serve check.

    Deployed apps sit behind SSO: a bearer token GET follows the redirect to a
    200 login page (whose body even contains ``<html``), so a token check
    false-passes. The Apps *front door* also answers before the app *container*
    behind it finishes starting — an unauthenticated token-GET sees the login
    200 (readiness thinks it's up) while an authenticated request reaches the
    still-starting container and 502s. So we drive a real browser carrying the
    saved storageState and retry on 5xx until the container actually serves,
    then assert the app's OWN content rendered (not the login page), using the
    per-template ``expect`` strings so a generic shell/error page can't pass.
    """
    assert_browser_installed()
    deadline = time.time() + 240  # app container can lag the front door, esp. agents
    status, html, final_url = 0, "", ""
    while True:
        status, html, final_url = _browser_load(storage_state, f"{app_url}/", expect, click)
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

    if verify in ("html", "obo"):
        # html: `expect` is the app's own content. obo: `expect` is a success signal
        # that renders ONLY if the forwarded user token's downstream call succeeded
        # — so a token-less/403 render (header only, then an exception) can't pass.
        assert_html_rendered(html, expect)
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

    # --val-force-build: dependency-only changes (e.g. lockfile bumps) need every
    # npm template to still install + build, including OBO templates that the
    # deploy path would otherwise skip. Build-only, no deploy. AppKit templates'
    # prebuild runs `appkit generate-types`, which needs a warehouse to type the
    # SQL queries (Apps injects it from the bound resource); borrow the shared
    # app's, or tsc fails on untyped query results. On unified hosts (profile has
    # a workspace_id, e.g. dogfood staging) AppKit's JS SDK only sends the
    # X-Databricks-Org-Id routing header in experimental unified-host mode;
    # without it every query 403s ("account admin") and typegen degrades.
    if request.config.getoption("--val-force-build"):
        from template_config import REPO_ROOT
        if not (REPO_ROOT / val_template.name / "package.json").exists():
            pytest.skip("--val-force-build: no package.json")
        extra_env = force_build_env(val_cfg.shared_app_name, val_cfg.profile)
        with tempfile.TemporaryDirectory(prefix=f"val-{val_template.name}-") as tmp:
            build_template(val_template.name, Path(tmp), extra_env)
        return

    # --val-verify-as: force the deploy path with the given verify mode, e.g.
    # `spa` to prove build/OBO templates install + serve on the Apps runtime after
    # a dependency-only change (no OBO success-signal needed).
    verify = request.config.getoption("--val-verify-as") or val_template.verify

    # OBO (on-behalf-of-user): exercised like `html`, but the shared app must be
    # CREATED with the OBO scope union + resource bindings (see the validate-templates
    # skill) — Databricks binds the forwarded-token scopes at app creation, so scopes
    # added to an existing app do NOT reach `X-Forwarded-Access-Token`. A template is
    # validated only when it declares `expect`: a string that renders ONLY if the
    # forwarded user token's downstream call SUCCEEDED (not the always-rendered page
    # header). Templates without a wired success-signal (or needing a binding the
    # shared app lacks, e.g. a UC connection) skip until one is added.
    if verify == "obo" and not val_template.expect:
        pytest.skip("OBO template not yet wired for e2e (no success-signal expect)")

    # Build-only path: no shared app, no deploy.
    if verify == "build":
        if request.config.getoption("--val-setup-only"):
            pytest.skip("--val-setup-only: nothing to set up for build-only template")
        with tempfile.TemporaryDirectory(prefix=f"val-{val_template.name}-") as tmp:
            build_template(val_template.name, Path(tmp))
        return

    # Deploy path requires an app.yaml (command + env). Templates without one are
    # DAB-only (databricks.yml) and can't be exercised via the shared-app source
    # deploy — a source-level deploy would leave the previous template's command.
    from template_config import REPO_ROOT
    if not (REPO_ROOT / val_template.name / "app.yaml").exists():
        pytest.skip("no app.yaml — DAB-only, not deployable via the shared app")

    # Deploy + browser-serve path (html / spa / mcp / api / obo).
    shared_app = request.getfixturevalue("shared_app")
    if request.config.getoption("--val-setup-only"):
        pytest.skip("--val-setup-only: shared app ensured, skipping deploy")

    if not STORAGE_STATE.exists():
        pytest.skip(f"no storageState at {STORAGE_STATE} — run auth_setup.py first")

    ws_path = f"{val_cfg.workspace_source_root}/{val_template.name}"
    with tempfile.TemporaryDirectory(prefix=f"val-{val_template.name}-") as tmp:
        src = prepare_source(val_template.name, Path(tmp),
                             request.config.getoption("--val-bundle-chatbot-ui"))
        if val_template.replace:
            n = apply_replacements(src, val_template.replace)
            _log(f"[{val_template.name}] applied config replacements to {n} file(s)")
        sync_source(src, ws_path, val_cfg.profile)
        apps_deploy_source(shared_app, ws_path, val_cfg.profile)
        try:
            app_url, _token = wait_for_app_ready_generic(
                shared_app, val_cfg.profile, health_path_for(verify)
            )
            verify_serving(
                verify, app_url, str(STORAGE_STATE),
                val_template.expect, val_template.obo_click,
            )
        except Exception:
            _log_build_failure(shared_app, val_cfg.profile)
            raise


# ---------------------------------------------------------------------------
# Crash-handling validation (special case) — part of the standard run.
#
# The checks above prove templates SERVE. These prove the inverse the diagnostics
# bootstrap exists for: a deployed app that CRASHES on startup still routes a
# usable traceback to its log stream (read at <app-url>/logz; the apps-logs CLI is
# 302-blocked on dogfood). Fixtures live in crash-examples/ and crash by default.
# ---------------------------------------------------------------------------

CRASH_CANARY = "DIAGNOSTICS_E2E_CANARY"
CRASH_RESTORE_TEMPLATE = "streamlit-hello-world-app"
# (id/lang, fixture dir relative to this file, stack marker expected in /logz)
CRASH_FIXTURES = [
    ("python", "crash-examples/python_crash_app", "Traceback (most recent call last)"),
    ("node", "crash-examples/node_crash_app", "uncaughtException"),
]


def force_build_env(app_name: str, profile: str) -> dict[str, str]:
    """Env for a --val-force-build `npm run build`: the profile, the shared app's
    warehouse (for AppKit typegen) and, on unified hosts, the workspace ID plus
    the JS SDK's unified-host flag so it sends X-Databricks-Org-Id."""
    env = {"DATABRICKS_CONFIG_PROFILE": profile}
    warehouse_id = _shared_app_warehouse_id(app_name, profile)
    if warehouse_id:
        env["DATABRICKS_WAREHOUSE_ID"] = warehouse_id
    workspace_id = _profile_workspace_id(profile)
    if workspace_id:
        env["DATABRICKS_WORKSPACE_ID"] = workspace_id
        env["DATABRICKS_EXPERIMENTAL_IS_UNIFIED_HOST"] = "true"
    return env


def _profile_workspace_id(profile: str) -> str:
    """Return the profile's workspace_id (set on unified hosts), or ''."""
    from databricks.sdk.core import Config

    return str(Config(profile=profile).workspace_id or "")


def _shared_app_warehouse_id(app_name: str, profile: str) -> str:
    """Return the id of the app's bound sql-warehouse resource, or '' if none."""
    r = _run_cmd(
        ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
        timeout=60,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return ""
    for res in json.loads(r.stdout).get("resources", []) or []:
        if "sql_warehouse" in res:
            return res["sql_warehouse"].get("id", "")
    return ""


def _apps_status(app_name: str, profile: str) -> tuple[str, str, str]:
    """Return (state, url, message) for the app, or ('','','') if unreadable."""
    r = _run_cmd(
        ["databricks", "apps", "get", app_name, "-p", profile, "--output", "json"],
        timeout=60,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return "", "", ""
    data = json.loads(r.stdout)
    status = data.get("app_status", {}) or {}
    return status.get("state", ""), (data.get("url", "") or "").rstrip("/"), status.get("message", "")


def _wait_for_crash(app_name: str, profile: str) -> tuple[str, str, str]:
    """Poll until the app settles into a non-RUNNING (crashed) state."""
    for _ in range(MAX_POLLS):
        state, url, msg = _apps_status(app_name, profile)
        if state and state != "RUNNING":
            return state, url, msg
        time.sleep(POLL_INTERVAL)
    return _apps_status(app_name, profile)


@pytest.fixture(scope="module")
def crash_restore(val_cfg):
    """After the crash cases, redeploy a known-good template so the shared app is
    not left crashed/UNAVAILABLE for the next user or run."""
    yield
    try:
        with tempfile.TemporaryDirectory(prefix="crash-restore-") as tmp:
            src = prepare_source(CRASH_RESTORE_TEMPLATE, Path(tmp))
            ws_path = f"{val_cfg.workspace_source_root}/{CRASH_RESTORE_TEMPLATE}"
            sync_source(src, ws_path, val_cfg.profile)
            apps_deploy_source(val_cfg.shared_app_name, ws_path, val_cfg.profile)
        _log(f"crash tests: restored {val_cfg.shared_app_name} -> {CRASH_RESTORE_TEMPLATE}")
    except Exception as exc:  # noqa: BLE001
        _log(f"crash tests: WARNING restore failed: {exc!r} (redeploy a template manually)")


@pytest.mark.parametrize(
    "lang,rel,stack_marker", CRASH_FIXTURES, ids=[c[0] for c in CRASH_FIXTURES]
)
def test_crash_diagnostics_deployed(lang, rel, stack_marker, val_cfg, shared_app, crash_restore, request):
    """Deploy a crash fixture, confirm it CRASHES, and confirm its diagnostic
    traceback reaches /logz (marker + app.diagnostics logger + a stack)."""
    if request.config.getoption("--val-setup-only"):
        pytest.skip("--val-setup-only: shared app ensured, skipping deploy")
    if not STORAGE_STATE.exists():
        pytest.skip(f"no storageState at {STORAGE_STATE} — run auth_setup.py first")
    assert_browser_installed()

    fixture_dir = Path(__file__).parent / rel
    ws_path = f"{val_cfg.workspace_source_root}/crash-{lang}"
    sync_source(fixture_dir, ws_path, val_cfg.profile)
    # Single deploy attempt — a crash fixture is EXPECTED to fail, so do NOT use the
    # retrying apps_deploy_source (which would re-attempt the doomed deploy N times).
    dep = subprocess.run(
        ["databricks", "apps", "deploy", shared_app, "--source-code-path", ws_path, "-p", val_cfg.profile],
        capture_output=True, text=True, timeout=BUNDLE_TIMEOUT,
    )
    _log(f"[crash-{lang}] deploy rc={dep.returncode} (non-zero expected for a crash)")

    state, url, msg = _wait_for_crash(shared_app, val_cfg.profile)
    assert state and state != "RUNNING", (
        f"expected the app to CRASH (non-RUNNING state); got state={state!r} msg={msg!r}"
    )
    assert url, "no app url to read /logz from"

    _, logz, _ = _browser_load(str(STORAGE_STATE), f"{url}/logz", expect=[CRASH_CANARY])
    # Log a short evidence snippet around the marker (proof the traceback reached
    # the log stream; useful for the run log / PR description).
    _idx = logz.find(CRASH_CANARY)
    if _idx != -1:
        _start = max(0, logz.rfind("\n", 0, max(0, _idx - 300)))
        _log(f"[crash-{lang}] /logz evidence:\n{logz[_start:_idx + 300].strip()}")
    assert CRASH_CANARY in logz, f"induced-crash marker not in /logz; got: {logz[:400]}"
    assert "app.diagnostics" in logz, f"no app.diagnostics evidence in /logz; got: {logz[:400]}"
    assert stack_marker in logz, f"stack marker {stack_marker!r} not in /logz; got: {logz[:400]}"
