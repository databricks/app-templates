"""Per-kind functional test runners."""
from __future__ import annotations
import os, sys
from pathlib import Path
import requests
from helpers import _run_cmd

AGENT_PAYLOAD = {"input": [{"role": "user", "content": "What time is it? Use the get_current_time tool."}]}


def _chromium_present() -> bool:
    cache_dirs = []
    if sys.platform == "darwin":
        cache_dirs.append(Path.home() / "Library" / "Caches" / "ms-playwright")
    cache_dirs.append(Path.home() / ".cache" / "ms-playwright")  # linux
    patterns = ("chromium-*", "chromium_headless_shell-*")
    for d in cache_dirs:
        if d.exists() and any(any(d.glob(p)) for p in patterns):
            return True
    return False


def assert_browser_installed() -> None:
    if not _chromium_present():
        raise RuntimeError("Chromium not installed for Playwright. Run: playwright install chromium")


def run_node_playwright(template_dir: Path, base_url: str, storage_state: str | None,
                         project: str | None = None, grep: str | None = None) -> None:
    assert_browser_installed()
    env = {**os.environ, "PLAYWRIGHT_BASE_URL": base_url}
    if storage_state:
        env["PLAYWRIGHT_STORAGE_STATE"] = storage_state
    cmd = ["npx", "playwright", "test"]
    if project:
        cmd += ["--project", project]
    if grep:
        cmd += ["-g", grep]
    r = _run_cmd(cmd, cwd=template_dir, env=env, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f"node playwright failed:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")


def run_py_playwright(template_dir: Path, spec: str, base_url: str, storage_state: str | None) -> None:
    # The spec drives a browser at PLAYWRIGHT_BASE_URL and imports no app code,
    # so it must run under the orchestrator's own interpreter (this venv has
    # playwright+pytest) rather than the template's venv (which has the app's
    # deps, e.g. streamlit, but not playwright/pytest).
    assert_browser_installed()
    env = {**os.environ, "PLAYWRIGHT_BASE_URL": base_url}
    if storage_state:
        env["PLAYWRIGHT_STORAGE_STATE"] = storage_state
    spec_path = str(Path(template_dir) / spec)
    r = _run_cmd([sys.executable, "-m", "pytest", spec_path, "-q"],
                 cwd=Path(__file__).parent, env=env, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f"py playwright failed:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")


def run_mcp(base_url: str) -> None:
    # MCP servers answer non-5xx at the base path or the SSE endpoint
    resp = requests.get(base_url + "/", timeout=30)
    if resp.status_code >= 500:
        raise RuntimeError(f"MCP server returned {resp.status_code}")


def run_agent_api(base_url: str, token: str | None) -> None:
    headers = {"Authorization": f"Bearer {token}"} if token else None
    resp = requests.post(base_url + "/invocations", json=AGENT_PAYLOAD, headers=headers, timeout=120)
    resp.raise_for_status()
    if "output" not in resp.json():
        raise RuntimeError("agent /invocations missing 'output'")


def openai_serving_sso_walled(probe_endpoint: str = "databricks-claude-sonnet-5-5") -> bool:
    """True when this workspace SSO-redirects the OpenAI-compat serving path.

    On dogfood staging, a local bearer POST to /serving-endpoints/<name>/invocations
    303-redirects to the login page, which langchain/OpenAI clients receive as HTML
    and mishandle ('str' object has no attribute 'choices'). The SDK-native query and
    deployed SP path are unaffected. We detect the wall so model-dependent local rows
    skip (not fail) here, while still passing on a normal workspace.

    Conservative: returns True only on a clear login-page signature; any other error
    returns False so genuine test failures are not masked as skips.
    """
    try:
        from databricks.sdk import WorkspaceClient
        profile = os.environ.get("DATABRICKS_CONFIG_PROFILE")
        w = WorkspaceClient(profile=profile) if profile else WorkspaceClient()
        token = (w.config.authenticate() or {}).get("Authorization", "").split(" ")[-1]
        host = (w.config.host or "").rstrip("/")
        if not host or not token:
            return False
        resp = requests.post(
            f"{host}/serving-endpoints/{probe_endpoint}/invocations",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"messages": [{"role": "user", "content": "ping"}]},
            timeout=30, allow_redirects=True,
        )
        return looks_like_login_page(resp.text, str(resp.url))
    except Exception:
        return False


def looks_like_login_page(html: str, final_url: str) -> bool:
    u = (final_url or "").lower()
    if any(s in u for s in ("/login", "/oidc", "accounts.cloud.databricks", "login.databricks")):
        return True
    return "sign in to databricks" in (html or "").lower()


def deployed_auth_ok(app_url: str, storage_state: str) -> bool:
    """Load the deployed app with the saved session; False if it bounced to SSO login."""
    assert_browser_installed()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(storage_state=storage_state)
        page = ctx.new_page()
        page.goto(app_url, wait_until="domcontentloaded")
        bad = looks_like_login_page(page.content(), page.url)
        b.close()
    return not bad
