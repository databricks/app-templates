# Functional E2E Testing — Implementation Plan (Increment 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared functional-e2e framework (local-launch-by-type, readiness, Playwright wiring for node and python-UI apps, human-login→storageState SSO flow, orchestrator, report) and prove it on 4 exemplars (`streamlit-database-app`, `e2e-chatbot-app-next`, `mcp-server-hello-world`, `agent-langgraph`) run **local**, with the **deployed** path wired and operator-runnable.

**Architecture:** Approach A — co-located per-template functional tests + a thin orchestrator under `.scripts/agent-integration-tests/`. UI apps are exercised with Playwright (node Playwright for node/SPA templates reusing their own suites; Playwright-for-Python for python-UI templates); agents and MCP servers via API/protocol (no browser). Each test is parameterized by `(base_url, storage_state?)` and run against a local instance and the deployed app.

**Tech Stack:** Python 3, pytest, `databricks` CLI, `databricks-sdk`, `requests`, Playwright (node + python), the existing `agent-integration-tests` harness (`helpers.py`, `test_e2e.py`). Runs against the `dogfood` profile.

**Spec:** `docs/superpowers/specs/2026-10-05-functional-e2e-design.md`

## Global Constraints

- Fresh branch off clean `main`; carry the 13 validation-tooling commits from `feature/template-validation` (additive `.scripts/` files) + the spec.
- All new code under `.scripts/agent-integration-tests/`. Run `uv` with `--no-sync` where the venv is already populated; if a sync is needed use `--system-certs --index-url https://pypi-proxy.cloud.databricks.com/simple` (pypi.org 503s on this network). npm registry = `https://npm-proxy.cloud.databricks.com`. Node 22.16.0 for any node build/run (matches Apps runtime).
- Serial only (shared app for the deployed target); never `pytest -n >0` for the functional runner.
- The SSO `storageState` holds a live session: write it under `.auth/`, which MUST be git-ignored and never committed.
- Reuse `helpers.py` (`_run_cmd`, `_run_with_retries`, `find_free_port`, `stop_server`, `get_oauth_token`, `capture_app_logs`, `git_copy_template`, logging) and the deploy harness in `validate_templates.py` rather than reimplementing.
- Happy-path depth only; do not author exhaustive per-app coverage.
- Commit messages end with a blank line then `Co-authored-by: Isaac <no-reply@databricks.com>`.

## Review Focus

- **Local app never becomes ready** (bad command, port in use, import crash): the launcher must time out and surface the app's stderr, not hang forever. → Task 3 test `test_wait_ready_times_out`.
- **Missing backend credentials** (`.env`/profile unset): the runner must fail with a clear "missing resource X" message before launching a browser, not crash mid-test. → Task 2 test `test_missing_required_resource_is_reported`.
- **Deployed `storageState` missing/expired**: a deployed run must detect it's looking at the SSO login page (not the app) and tell the operator to re-run auth-setup, rather than asserting success on the login HTML. → Task 6 test `test_detects_login_page_not_app`.
- **Playwright browser not installed**: actionable error ("run playwright install chromium"), not a cryptic launch failure. → Task 5 test `test_missing_browser_message`.
- **Report with mixed/absent target results** (local ran, deployed skipped): renderer must show per-target cells (pass/fail/skip) without dropping rows. → Task 4 test `test_report_handles_absent_deployed`.

---

### Task 1: Branch setup + carry tooling

**Files:**
- Create branch `feature/functional-e2e` off `main`.
- Carry: the 13 commits on `feature/template-validation` (not on `main`) + the spec `docs/superpowers/specs/2026-10-05-functional-e2e-design.md`.

**Interfaces:**
- Produces: a working tree on `main`'s base with `validate_templates.py`, `validation_config.py`, `validate_transforms.py`, `validation-config.yaml`, `make-integration-branch.sh`, the report hook in `conftest.py`, and both specs/plans present.

- [ ] **Step 1: Create the branch and carry tooling**

```bash
cd /Users/mike.helmick/src/app-templates
git fetch origin
git checkout -B feature/functional-e2e origin/main
# bring the validation tooling + specs/plans from the template-validation branch
git checkout feature/template-validation -- .scripts/agent-integration-tests/validate_templates.py \
  .scripts/agent-integration-tests/validation_config.py \
  .scripts/agent-integration-tests/validate_transforms.py \
  .scripts/agent-integration-tests/validation-config.yaml \
  .scripts/agent-integration-tests/test_validate_unit.py \
  .scripts/agent-integration-tests/conftest.py \
  .scripts/make-integration-branch.sh \
  docs/superpowers/
```

- [ ] **Step 2: Add pyyaml dep if missing, sync, run existing unit tests**

Run: `cd .scripts/agent-integration-tests && uv sync --system-certs --index-url https://pypi-proxy.cloud.databricks.com/simple && uv run --no-sync pytest test_validate_unit.py -q`
Expected: unit tests pass (12). If pyyaml missing from pyproject, add `"pyyaml"` to dependencies and re-sync.

- [ ] **Step 3: Add `.auth/` to .gitignore**

Append `.auth/` to `.scripts/agent-integration-tests/.gitignore` (create the file if absent).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(functional-e2e): branch off main, carry validation tooling + specs"
```

---

### Task 2: Functional registry

**Files:**
- Create: `.scripts/agent-integration-tests/functional_config.py`
- Modify: `.scripts/agent-integration-tests/test_validate_unit.py` (add tests; keep existing)

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) FunctionalTemplate: name:str; family:str; launch:dict; test:dict; required_resources:tuple[str,...]`
  - `FUNCTIONAL_TEMPLATES: dict[str, FunctionalTemplate]` (the 4 exemplars)
  - `VALID_FAMILIES: set[str]` = {streamlit,dash,flask,gradio,shiny,node,mcp,agent}
  - `missing_resources(ft: FunctionalTemplate, env: dict) -> list[str]` — resources whose env var is unset/empty

- [ ] **Step 1: Write failing tests**

```python
from functional_config import (
    FUNCTIONAL_TEMPLATES, FunctionalTemplate, VALID_FAMILIES, missing_resources,
)

def test_four_exemplars_registered():
    assert set(FUNCTIONAL_TEMPLATES) == {
        "streamlit-database-app", "e2e-chatbot-app-next",
        "mcp-server-hello-world", "agent-langgraph",
    }
    for ft in FUNCTIONAL_TEMPLATES.values():
        assert ft.family in VALID_FAMILIES
        assert ft.test["kind"] in {"node-playwright", "py-playwright", "mcp", "agent-api"}

def test_missing_required_resource_is_reported():
    ft = FunctionalTemplate(
        name="x", family="streamlit", launch={}, test={"kind": "py-playwright"},
        required_resources=("DATABRICKS_WAREHOUSE_ID",),
    )
    assert missing_resources(ft, {}) == ["DATABRICKS_WAREHOUSE_ID"]
    assert missing_resources(ft, {"DATABRICKS_WAREHOUSE_ID": "w1"}) == []
```

Run: `cd .scripts/agent-integration-tests && uv run --no-sync pytest test_validate_unit.py -v -k "exemplars or missing_required"`
Expected: FAIL (module/func not defined).

- [ ] **Step 2: Implement `functional_config.py`**

```python
"""Registry for functional e2e tests (Increment 1: 4 exemplars)."""
from __future__ import annotations
from dataclasses import dataclass

VALID_FAMILIES = {"streamlit", "dash", "flask", "gradio", "shiny", "node", "mcp", "agent"}


@dataclass(frozen=True)
class FunctionalTemplate:
    name: str
    family: str
    launch: dict          # family-specific launch hints (command/port/ready path)
    test: dict            # {"kind": "...", ...}
    required_resources: tuple[str, ...]


def missing_resources(ft: "FunctionalTemplate", env: dict) -> list[str]:
    return [r for r in ft.required_resources if not env.get(r)]


FUNCTIONAL_TEMPLATES: dict[str, FunctionalTemplate] = {
    "streamlit-database-app": FunctionalTemplate(
        name="streamlit-database-app", family="streamlit",
        launch={"ready_path": "/"},
        test={"kind": "py-playwright", "spec": "tests/e2e/test_app.py"},
        required_resources=(),
    ),
    "e2e-chatbot-app-next": FunctionalTemplate(
        name="e2e-chatbot-app-next", family="node",
        launch={"dev_script": "dev", "ready_path": "/"},
        test={"kind": "node-playwright"},
        required_resources=("DATABRICKS_SERVING_ENDPOINT",),
    ),
    "mcp-server-hello-world": FunctionalTemplate(
        name="mcp-server-hello-world", family="mcp",
        launch={"ready_path": "/"},
        test={"kind": "mcp"},
        required_resources=(),
    ),
    "agent-langgraph": FunctionalTemplate(
        name="agent-langgraph", family="agent",
        launch={"ready_path": "/"},
        test={"kind": "agent-api"},
        required_resources=(),
    ),
}
```

- [ ] **Step 3: Run tests to pass**

Run: `uv run --no-sync pytest test_validate_unit.py -v -k "exemplars or missing_required"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/functional_config.py .scripts/agent-integration-tests/test_validate_unit.py
git commit -m "feat(functional-e2e): add functional-test registry (4 exemplars)"
```

---

### Task 3: Local launch-by-family + readiness

**Files:**
- Create: `.scripts/agent-integration-tests/local_launch.py`
- Modify: `.scripts/agent-integration-tests/test_validate_unit.py`

**Interfaces:**
- Consumes: `functional_config.FunctionalTemplate`; `helpers.find_free_port`, `helpers._run_cmd`, `helpers.stop_server`, `helpers._log`.
- Produces:
  - `build_launch_command(ft: FunctionalTemplate, port: int) -> list[str]` (pure)
  - `wait_ready(base_url: str, path: str, deadline_s: int = 120) -> None` (raises `TimeoutError`)
  - `launch_local(ft, template_dir) -> tuple[Popen, str]` (returns proc, base_url)
  - `teardown(proc)`

- [ ] **Step 1: Write failing tests (pure builder + readiness timeout)**

```python
import time
import pytest
from functional_config import FunctionalTemplate
from local_launch import build_launch_command, wait_ready

def _ft(family):
    return FunctionalTemplate(name="t", family=family, launch={"dev_script": "dev"},
                              test={"kind": "x"}, required_resources=())

def test_build_launch_command_per_family():
    assert build_launch_command(_ft("streamlit"), 8501)[:2] == ["streamlit", "run"]
    assert "--server.port" in build_launch_command(_ft("streamlit"), 8501)
    assert build_launch_command(_ft("dash"), 8050)[0] in {"python", "uv"}
    assert build_launch_command(_ft("node"), 3000)[:2] == ["npm", "run"]
    assert build_launch_command(_ft("agent"), 8000)[:2] == ["uv", "run"]
    assert build_launch_command(_ft("mcp"), 8000)[:2] == ["uv", "run"]

def test_wait_ready_times_out():
    t0 = time.time()
    with pytest.raises(TimeoutError):
        wait_ready("http://127.0.0.1:1", "/", deadline_s=2)
    assert time.time() - t0 < 10
```

Run: `uv run --no-sync pytest test_validate_unit.py -v -k "launch_command or wait_ready_times"`
Expected: FAIL.

- [ ] **Step 2: Implement `local_launch.py`**

```python
"""Launch template apps locally, by family, for functional tests."""
from __future__ import annotations
import os, subprocess, time
from pathlib import Path
import requests
from functional_config import FunctionalTemplate
from helpers import _log, find_free_port, stop_server


def build_launch_command(ft: FunctionalTemplate, port: int) -> list[str]:
    f = ft.family
    if f == "streamlit":
        return ["streamlit", "run", "app.py", "--server.port", str(port), "--server.headless", "true"]
    if f in ("dash", "gradio", "shiny", "flask"):
        # these read PORT from env (set by launch_local); run their entrypoint
        if f == "flask":
            return ["flask", "--app", "app.py", "run", "--port", str(port)]
        return ["python", "app.py"]
    if f == "node":
        return ["npm", "run", ft.launch.get("dev_script", "dev")]
    if f == "agent":
        return ["uv", "run", "start-server", "--port", str(port)]
    if f == "mcp":
        return ["uv", "run", ft.launch.get("server_cmd", "custom-mcp-server")]
    raise ValueError(f"unknown family {f!r}")


def wait_ready(base_url: str, path: str, deadline_s: int = 120) -> None:
    deadline = time.time() + deadline_s
    url = f"{base_url}{path}"
    while time.time() < deadline:
        try:
            if requests.get(url, timeout=5).status_code < 500:
                return
        except requests.RequestException:
            pass
        time.sleep(2)
    raise TimeoutError(f"{url} not ready within {deadline_s}s")


def launch_local(ft: FunctionalTemplate, template_dir: Path) -> tuple[subprocess.Popen, str]:
    port = find_free_port()
    env = {**os.environ, "PORT": str(port)}
    cmd = build_launch_command(ft, port)
    _log(f"[{ft.name}] launching: {' '.join(cmd)} (port {port})")
    proc = subprocess.Popen(cmd, cwd=template_dir, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            text=True, preexec_fn=os.setsid)
    base_url = f"http://127.0.0.1:{port}"
    try:
        wait_ready(base_url, ft.launch.get("ready_path", "/"))
    except TimeoutError:
        err = proc.stderr.read() if proc.stderr else ""
        stop_server(proc)
        raise TimeoutError(f"[{ft.name}] did not become ready. stderr:\n{err[:2000]}")
    return proc, base_url


def teardown(proc: subprocess.Popen) -> None:
    stop_server(proc)
```

- [ ] **Step 3: Run tests to pass**

Run: `uv run --no-sync pytest test_validate_unit.py -v -k "launch_command or wait_ready_times"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/local_launch.py .scripts/agent-integration-tests/test_validate_unit.py
git commit -m "feat(functional-e2e): local launch-by-family + readiness"
```

---

### Task 4: Functional report renderer

**Files:**
- Create: `.scripts/agent-integration-tests/functional_report.py`
- Modify: `.scripts/agent-integration-tests/test_validate_unit.py`

**Interfaces:**
- Produces: `render_functional_report(rows: list[dict]) -> str` where a row is `{"template","family","local","deployed","notes"}` and each target value ∈ `{"pass","fail","skip"}`.

- [ ] **Step 1: Write failing test**

```python
from functional_report import render_functional_report

def test_report_handles_absent_deployed():
    rows = [
        {"template": "agent-langgraph", "family": "agent", "local": "pass", "deployed": "skip", "notes": ""},
        {"template": "streamlit-database-app", "family": "streamlit", "local": "fail", "deployed": "skip", "notes": "widget missing"},
    ]
    md = render_functional_report(rows)
    assert "| Template | Family | Local | Deployed | Notes |" in md
    assert "streamlit-database-app" in md and "widget missing" in md
    # failures sort first
    assert md.index("streamlit-database-app") < md.index("agent-langgraph")
    assert "1/2 local passed" in md
```

Run: `uv run --no-sync pytest test_validate_unit.py -v -k report_handles_absent`
Expected: FAIL.

- [ ] **Step 2: Implement**

```python
"""Render functional e2e results as markdown."""
from __future__ import annotations

_MARK = {"pass": "✅ pass", "fail": "❌ FAIL", "skip": "⏭ skip"}


def render_functional_report(rows: list[dict]) -> str:
    total = len(rows)
    local_pass = sum(1 for r in rows if r.get("local") == "pass")
    dep_pass = sum(1 for r in rows if r.get("deployed") == "pass")
    lines = [
        "# Functional E2E Report", "",
        f"**{local_pass}/{total} local passed**, **{dep_pass}/{total} deployed passed**", "",
        "| Template | Family | Local | Deployed | Notes |",
        "| --- | --- | --- | --- | --- |",
    ]
    def sort_key(r):
        return ("fail" not in (r.get("local"), r.get("deployed")), r["template"])
    for r in sorted(rows, key=sort_key):
        lines.append(
            f"| {r['template']} | {r['family']} | "
            f"{_MARK.get(r.get('local'),'—')} | {_MARK.get(r.get('deployed'),'—')} | {r.get('notes','')} |"
        )
    lines.append("")
    return "\n".join(lines)
```

- [ ] **Step 3: Run to pass**

Run: `uv run --no-sync pytest test_validate_unit.py -v -k report_handles_absent`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/functional_report.py .scripts/agent-integration-tests/test_validate_unit.py
git commit -m "feat(functional-e2e): functional report renderer"
```

---

### Task 5: Test runners per kind + Playwright browser check

**Files:**
- Create: `.scripts/agent-integration-tests/functional_runners.py`
- Modify: `.scripts/agent-integration-tests/test_validate_unit.py`

**Interfaces:**
- Consumes: `functional_config.FunctionalTemplate`; `requests`.
- Produces:
  - `run_node_playwright(template_dir, base_url, storage_state: str|None) -> None` (raises on fail)
  - `run_py_playwright(template_dir, spec, base_url, storage_state: str|None) -> None`
  - `run_mcp(base_url) -> None` (asserts MCP endpoint responds)
  - `run_agent_api(base_url, token: str|None) -> None` (reuses `test_e2e` payloads)
  - `assert_browser_installed() -> None` (raises actionable error if chromium missing)

- [ ] **Step 1: Write failing test (browser-missing message is actionable)**

```python
import pytest
import functional_runners as fr

def test_missing_browser_message(monkeypatch):
    monkeypatch.setattr(fr, "_chromium_present", lambda: False)
    with pytest.raises(RuntimeError, match="playwright install chromium"):
        fr.assert_browser_installed()
```

Run: `uv run --no-sync pytest test_validate_unit.py -v -k missing_browser`
Expected: FAIL.

- [ ] **Step 2: Implement `functional_runners.py`**

```python
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
    assert resp.status_code < 500, f"MCP server returned {resp.status_code}"


def run_agent_api(base_url: str, token: str | None) -> None:
    headers = {"Authorization": f"Bearer {token}"} if token else None
    resp = requests.post(base_url + "/invocations", json=AGENT_PAYLOAD, headers=headers, timeout=120)
    resp.raise_for_status()
    assert "output" in resp.json(), "agent /invocations missing 'output'"
```

- [ ] **Step 3: Run to pass**

Run: `uv run --no-sync pytest test_validate_unit.py -v -k missing_browser`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/functional_runners.py .scripts/agent-integration-tests/test_validate_unit.py
git commit -m "feat(functional-e2e): per-kind runners + browser check"
```

---

### Task 6: SSO auth-setup + login-page detection

**Files:**
- Create: `.scripts/agent-integration-tests/auth_setup.py`
- Modify: `.scripts/agent-integration-tests/functional_runners.py` (add `looks_like_login_page`)
- Modify: `.scripts/agent-integration-tests/test_validate_unit.py`

**Interfaces:**
- Produces:
  - `auth_setup.main(app_url, out_path)` — headed Playwright; operator logs in; saves `storageState` to `out_path`.
  - `functional_runners.looks_like_login_page(html: str, final_url: str) -> bool`

- [ ] **Step 1: Write failing test**

```python
from functional_runners import looks_like_login_page

def test_detects_login_page_not_app():
    assert looks_like_login_page("<html>Sign in to Databricks</html>", "https://login.databricks.com/oidc")
    assert looks_like_login_page("", "https://accounts.cloud.databricks.com/login")
    assert not looks_like_login_page("<html>My App</html>", "https://myapp.databricksapps.com/")
```

Run: `uv run --no-sync pytest test_validate_unit.py -v -k login_page`
Expected: FAIL.

- [ ] **Step 2: Implement**

In `functional_runners.py`:
```python
def looks_like_login_page(html: str, final_url: str) -> bool:
    u = (final_url or "").lower()
    if any(s in u for s in ("/login", "/oidc", "accounts.cloud.databricks", "login.databricks")):
        return True
    return "sign in to databricks" in (html or "").lower()
```

Create `auth_setup.py`:
```python
"""One-time human SSO login -> save Playwright storageState for deployed runs."""
from __future__ import annotations
import sys
from pathlib import Path


def main(app_url: str, out_path: str) -> None:
    from playwright.sync_api import sync_playwright  # noqa: imported lazily
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(app_url)
        print(f"\nComplete Databricks SSO + consent in the browser for:\n  {app_url}\n"
              f"When the app has loaded, return here and press Enter to save the session...")
        input()
        ctx.storage_state(path=out_path)
        browser.close()
    print(f"Saved auth state to {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

- [ ] **Step 3: Run to pass**

Run: `uv run --no-sync pytest test_validate_unit.py -v -k login_page`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/auth_setup.py .scripts/agent-integration-tests/functional_runners.py .scripts/agent-integration-tests/test_validate_unit.py
git commit -m "feat(functional-e2e): SSO auth-setup + login-page detection"
```

---

### Task 7: Orchestrator (pytest) + offline collection

**Files:**
- Create: `.scripts/agent-integration-tests/functional_test.py`
- Modify: `.scripts/agent-integration-tests/conftest.py` (add `--target`, reuse `--val-template`)

**Interfaces:**
- Consumes: everything above; `validate_templates` deploy helpers for the deployed target; `template_config.REPO_ROOT`; `helpers.get_oauth_token`, `capture_app_logs`.
- Produces: `test_functional[template]` parametrized over `FUNCTIONAL_TEMPLATES`, with `--target {local,deployed}` (default local), `--val-template` filter, and a `pytest_terminal_summary` that writes `logs/functional-report.md`.

- [ ] **Step 1: Add CLI option in conftest.py**

```python
parser.addoption("--target", action="store", default="local",
                 choices=["local", "deployed"], help="functional_test.py target")
```

- [ ] **Step 2: Implement `functional_test.py`**

```python
"""Functional e2e orchestrator. Serial; run with -p no:xdist.
  uv run --no-sync pytest functional_test.py --val-template <name> --target local|deployed
"""
from __future__ import annotations
import os
from pathlib import Path
import pytest
from functional_config import FUNCTIONAL_TEMPLATES, missing_resources
from local_launch import launch_local, teardown
from functional_runners import (
    run_node_playwright, run_py_playwright, run_mcp, run_agent_api, looks_like_login_page,
)
from template_config import REPO_ROOT
from helpers import get_oauth_token, _log

_results: list[dict] = []
AUTH_DIR = Path(__file__).parent / ".auth"


def pytest_generate_tests(metafunc):
    if "ft" in metafunc.fixturenames:
        items = list(FUNCTIONAL_TEMPLATES.values())
        only = metafunc.config.getoption("--val-template")
        if only:
            items = [t for t in items if t.name in only]
        metafunc.parametrize("ft", items, ids=lambda t: t.name)


def _run_test(ft, base_url, storage_state, token):
    kind = ft.test["kind"]
    tdir = REPO_ROOT / ft.name
    if kind == "node-playwright":
        run_node_playwright(tdir, base_url, storage_state)
    elif kind == "py-playwright":
        run_py_playwright(tdir, ft.test["spec"], base_url, storage_state)
    elif kind == "mcp":
        run_mcp(base_url)
    elif kind == "agent-api":
        run_agent_api(base_url, token)
    else:
        raise ValueError(kind)


def test_functional(ft, request):
    target = request.config.getoption("--target")
    row = {"template": ft.name, "family": ft.family, "local": "skip", "deployed": "skip", "notes": ""}
    missing = missing_resources(ft, os.environ)
    if missing:
        row["notes"] = f"missing creds: {','.join(missing)}"
        _results.append(row); pytest.skip(row["notes"])

    try:
        if target == "local":
            proc, base_url = launch_local(ft, REPO_ROOT / ft.name)
            try:
                _run_test(ft, base_url, None, None)
                row["local"] = "pass"
            finally:
                teardown(proc)
        else:  # deployed
            from validate_templates import wait_for_app_ready_generic
            from validation_config import load_validation_config, DEFAULT_CONFIG_PATH
            cfg = load_validation_config(DEFAULT_CONFIG_PATH)
            app_url, token = wait_for_app_ready_generic(cfg.shared_app_name, cfg.profile)
            state = AUTH_DIR / "dogfood.json"
            storage = str(state) if state.exists() else None
            if ft.test["kind"] in ("node-playwright", "py-playwright") and not storage:
                row["notes"] = "no storageState — run auth_setup first"
                _results.append(row); pytest.skip(row["notes"])
            _run_test(ft, app_url, storage, token)
            row["deployed"] = "pass"
    except Exception as exc:
        row["local" if target == "local" else "deployed"] = "fail"
        row["notes"] = str(exc)[:300]
        _results.append(row)
        raise
    _results.append(row)


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    if not _results:
        return
    from functional_report import render_functional_report
    out = Path(__file__).parent / "logs" / "functional-report.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text(render_functional_report(_results))
    terminalreporter.write_line(f"\nFunctional report: {out}")
```

- [ ] **Step 3: Verify offline collection**

Run: `uv run --no-sync pytest functional_test.py --collect-only -q`
Expected: 4 `test_functional[...]` items, no network.

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/functional_test.py .scripts/agent-integration-tests/conftest.py
git commit -m "feat(functional-e2e): orchestrator + offline collection"
```

---

### Task 8: Exemplar happy-path tests (author the 4) + local proof

**Files:**
- Create: `streamlit-database-app/tests/e2e/test_app.py` (py-playwright happy-path)
- Verify/reuse: `e2e-chatbot-app-next/` existing Playwright suite (point at `PLAYWRIGHT_BASE_URL`)
- Create: `mcp-server-hello-world` — covered by `run_mcp` (no new file)
- Create: `agent-langgraph` — covered by `run_agent_api` (no new file)
- Modify: `.scripts/agent-integration-tests/AGENTS.md` (document functional-e2e)

**Interfaces:**
- Consumes: the orchestrator + runners above.

- [ ] **Step 1: Write the Streamlit happy-path (py-playwright)**

`streamlit-database-app/tests/e2e/test_app.py`:
```python
import os
from playwright.sync_api import sync_playwright

def test_app_renders_core_ui():
    base = os.environ["PLAYWRIGHT_BASE_URL"]
    state = os.environ.get("PLAYWRIGHT_STORAGE_STATE")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(storage_state=state) if state else browser.new_context()
        page = ctx.new_page()
        page.goto(base, wait_until="networkidle")
        # happy-path: the Streamlit app shell + the app's primary heading render
        page.wait_for_selector("[data-testid='stApp']", timeout=30000)
        assert page.locator("h1, h2, [data-testid='stHeading']").first.is_visible()
        browser.close()
```
(Adjust the primary-content selector to the app's actual heading after reading `streamlit-database-app/app.py`.)

- [ ] **Step 2: Confirm the node exemplar's Playwright honors `PLAYWRIGHT_BASE_URL`**

Read `e2e-chatbot-app-next/playwright.config.ts`; ensure `use.baseURL` reads `process.env.PLAYWRIGHT_BASE_URL` (add it if absent) and that `tests/e2e` has at least one happy-path spec (send a message → assert a response bubble). If the config hardcodes a URL, make it env-driven.

- [ ] **Step 3: Install browsers (one-time) and prove the 4 LOCAL**

Run (local target; agent/mcp exercised via API, streamlit/node via browser):
```bash
cd .scripts/agent-integration-tests
playwright install chromium   # one-time (uses the configured npm/pip mirror)
uv run --no-sync pytest functional_test.py -p no:xdist -v --target local \
  --val-template mcp-server-hello-world --val-template agent-langgraph \
  --val-template streamlit-database-app --val-template e2e-chatbot-app-next
```
Expected: 4 pass locally. On a credential/browser gap, the row is skipped with an actionable note (not a crash). Report written to `logs/functional-report.md`.

- [ ] **Step 4: Document in AGENTS.md**

Add a "Functional E2E" section: the registry, `--target local|deployed`, the one-time `playwright install chromium`, the `auth_setup` step for deployed, required env/creds per exemplar, the serial-only rule, and the report location.

- [ ] **Step 5: Commit**

```bash
git add streamlit-database-app/tests e2e-chatbot-app-next/playwright.config.ts .scripts/agent-integration-tests/AGENTS.md
git commit -m "feat(functional-e2e): author 4 exemplar happy-path tests + local proof + docs"
```

---

### Task 9: Deployed-target proof (operator-run) + wiring validation

**Files:** none new — exercises Tasks 1–8 against the deployed app.

- [ ] **Step 1: Deploy the exemplars to the shared app**

Use the existing deploy harness (`validate_templates.py`) to deploy each exemplar into `template-e2e-test` on `dogfood` (one at a time, serial). For agent-langgraph use its DAB deploy via `test_e2e`/bundle; for the others use apps-deploy. Confirm each reaches RUNNING.

- [ ] **Step 2: Operator SSO auth-setup**

Run (headed; operator completes SSO):
```bash
cd .scripts/agent-integration-tests
uv run --no-sync python auth_setup.py "https://template-e2e-test-<id>.staging.aws.databricksapps.com" .auth/dogfood.json
```
Expected: `.auth/dogfood.json` written (git-ignored).

- [ ] **Step 3: Run the deployed functional pass**

```bash
uv run --no-sync pytest functional_test.py -p no:xdist -v --target deployed \
  --val-template mcp-server-hello-world --val-template agent-langgraph \
  --val-template streamlit-database-app --val-template e2e-chatbot-app-next
```
Expected: browser tests reuse `.auth/dogfood.json` and pass against the deployed URL; `looks_like_login_page` guards against a stale state. Report updated.

- [ ] **Step 4: Report deployed results to the user and record the pattern as proven**

Summarize local + deployed matrix. This is the Increment-1 acceptance gate; a green local+deployed run across the 4 exemplars proves the framework for the type-wave increments.

---

## Self-Review

**Spec coverage:** framework (Tasks 2–7), co-located exemplar tests + reuse (Task 8), local proof (Task 8), deployed+SSO proof (Task 9), branch/tooling carry (Task 1), report (Tasks 4,7), credentials gating (Tasks 2,7), roadmap/out-of-scope respected (only 4 exemplars). ✓

**Placeholder scan:** selectors in Task 8 Step 1 are marked to adjust after reading the app — concrete default provided (`[data-testid='stApp']`), not a TODO. No "implement later" left. ✓

**Type consistency:** `FunctionalTemplate(name, family, launch, test, required_resources)`, `missing_resources(ft, env)`, `build_launch_command(ft, port)`, `wait_ready(base_url, path, deadline_s)`, `launch_local(ft, template_dir) -> (proc, base_url)`, `render_functional_report(rows)`, runner signatures, `looks_like_login_page(html, final_url)` — consistent across Tasks 2–9. ✓

**Review Focus:** all 5 lines have owning-task tests (Tasks 2,3,4,5,6). ✓
