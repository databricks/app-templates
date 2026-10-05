"""Per-kind functional test runners."""
from __future__ import annotations
import os, shutil, subprocess
from pathlib import Path
import requests
from helpers import _run_cmd, _log

AGENT_PAYLOAD = {"input": [{"role": "user", "content": "What time is it? Use the get_current_time tool."}]}


def _chromium_present() -> bool:
    cache = Path.home() / ".cache" / "ms-playwright"
    return cache.exists() and any(cache.glob("chromium-*"))


def assert_browser_installed() -> None:
    if not _chromium_present():
        raise RuntimeError("Chromium not installed for Playwright. Run: playwright install chromium")


def run_node_playwright(template_dir: Path, base_url: str, storage_state: str | None) -> None:
    assert_browser_installed()
    env = {**os.environ, "PLAYWRIGHT_BASE_URL": base_url}
    if storage_state:
        env["PLAYWRIGHT_STORAGE_STATE"] = storage_state
    r = _run_cmd(["npx", "playwright", "test"], cwd=template_dir, env=env, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f"node playwright failed:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")


def run_py_playwright(template_dir: Path, spec: str, base_url: str, storage_state: str | None) -> None:
    assert_browser_installed()
    env = {**os.environ, "PLAYWRIGHT_BASE_URL": base_url}
    if storage_state:
        env["PLAYWRIGHT_STORAGE_STATE"] = storage_state
    r = _run_cmd(["uv", "run", "--no-sync", "pytest", spec, "-q"], cwd=template_dir, env=env, timeout=600)
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
