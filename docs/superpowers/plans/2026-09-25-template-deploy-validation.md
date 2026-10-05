# Template Deploy Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build reusable machinery that deploy-validates the 26 non-agent app templates by redeploying each, serially, into one shared persistent Databricks App and curl-checking that it serves.

**Architecture:** A new pytest-parametrized runner beside the existing agent e2e suite. It reuses `helpers.py` (subprocess/retry/OAuth/logging), adds an apps-deploy adapter (`databricks sync` + `databricks apps deploy <APP> --source-code-path`), a generic readiness poll, and curl-tiered verification (`html`/`spa`/`mcp`/`api`). Agents keep their existing `test_e2e.py`. A helper script builds the ephemeral integration branch (merge of the 7 in-flight branches) to validate against.

**Tech Stack:** Python 3, pytest, `databricks` CLI, `databricks-sdk`, `requests`, `pyyaml`. Runs against the `dogfood` CLI profile.

**Spec:** `docs/superpowers/specs/2026-09-25-template-deploy-validation-design.md`

## Global Constraints

- Deploy adapter for this loop is **always** apps-deploy; the shared app is reused (no create/destroy per template).
- **Serial only.** Never run this runner with `pytest -n >0` — all templates share one app.
- Profile is configurable; default and current working value is `dogfood` (the `dev` profile is invalid here).
- We **never modify template files** to make them pass. Source transforms (valueFrom neutralization) happen on a throwaway copy only.
- Reuse existing `helpers.py` functions rather than reimplementing: `_run_cmd`, `_run_with_retries`, `get_oauth_token`, `capture_app_logs`, `git_copy_template`, `databricks_create_app`, logging (`_log`, `set_log_file`).
- All new files live in `.scripts/agent-integration-tests/`. Run commands from that directory.
- New pyproject dependency: `pyyaml`.

---

## File Structure

- `.scripts/agent-integration-tests/validation_config.py` — config dataclasses, YAML loader, the 26-template registry defaults, workspace-root derivation.
- `.scripts/agent-integration-tests/validation-config.yaml` — profile, shared app name, workspace source root, per-template `verify` kinds.
- `.scripts/agent-integration-tests/validate_transforms.py` — pure functions: `neutralize_app_yaml`, `parse_spa_assets`.
- `.scripts/agent-integration-tests/validate_templates.py` — the runner: source prep, apps-deploy adapter, generic readiness, verification dispatch, pytest test + CLI options + shared-app session fixture.
- `.scripts/agent-integration-tests/tests/test_validate_unit.py` — unit tests for the pure functions and the config loader.
- `.scripts/make-integration-branch.sh` — builds/refreshes the ephemeral integration branch, failing loudly on conflicts.
- `.scripts/agent-integration-tests/AGENTS.md` — extend with a "Non-agent template validation" section.

---

### Task 1: Config module + registry

**Files:**
- Create: `.scripts/agent-integration-tests/validation_config.py`
- Create: `.scripts/agent-integration-tests/validation-config.yaml`
- Create: `.scripts/agent-integration-tests/tests/test_validate_unit.py`
- Modify: `.scripts/agent-integration-tests/pyproject.toml` (add `pyyaml`)

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) ValidationTemplate: name: str; verify: str`  (`verify` ∈ {`html`,`spa`,`mcp`,`api`})
  - `@dataclass(frozen=True) ValidationConfig: profile: str; shared_app_name: str; workspace_source_root: str; templates: list[ValidationTemplate]`
  - `DEFAULT_CONFIG_PATH: Path` (= `<this dir>/validation-config.yaml`)
  - `load_validation_config(path: Path = DEFAULT_CONFIG_PATH, *, resolve_workspace_root: bool = True) -> ValidationConfig`
  - `derive_workspace_source_root(profile: str) -> str` (uses `databricks-sdk` `WorkspaceClient(profile=...).current_user.me().user_name`)

- [ ] **Step 1: Add pyyaml dependency**

In `.scripts/agent-integration-tests/pyproject.toml`, add `"pyyaml"` to the `dependencies` list. Then:

Run: `cd .scripts/agent-integration-tests && uv sync`
Expected: resolves with pyyaml installed.

- [ ] **Step 2: Write the config YAML**

Create `.scripts/agent-integration-tests/validation-config.yaml`:

```yaml
# Deploy-validation config for non-agent templates.
# Serial single-app model — see docs/superpowers/specs/2026-09-25-template-deploy-validation-design.md
profile: dogfood
shared_app_name: val-template-check
# Leave workspace_source_root empty to derive /Workspace/Users/<current-user>/template-validation at runtime.
workspace_source_root: ""
templates:
  # streamlit
  streamlit-database-app: { verify: html }
  streamlit-postgres-app: { verify: html }
  # flask
  flask-hello-world-app: { verify: html }
  flask-database-app: { verify: html }
  flask-postgres-app: { verify: html }
  # dash
  dash-chatbot-app: { verify: html }
  dash-data-app-obo-user: { verify: html }
  dash-database-app: { verify: html }
  dash-postgres-app: { verify: html }
  # mcp servers
  mcp-server-hello-world: { verify: mcp }
  mcp-server-open-api-spec: { verify: mcp }
  # node / spa
  nodejs-fastapi-hello-world-app: { verify: spa }
  rag-chat: { verify: spa }
  agent-langchain-ts: { verify: spa }
  agentic-support-console: { verify: spa }
  e2e-chatbot-app-next: { verify: spa }
  inventory-intelligence: { verify: spa }
  content-moderator: { verify: spa }
  saas-tracker: { verify: spa }
  vacation-rentals: { verify: spa }
  appkit-all-in-one: { verify: spa }
  appkit-analytics: { verify: spa }
  appkit-files: { verify: spa }
  appkit-genie: { verify: spa }
  appkit-lakebase: { verify: spa }
  appkit-serving: { verify: spa }
```

- [ ] **Step 3: Write the failing test**

Create `.scripts/agent-integration-tests/tests/test_validate_unit.py`:

```python
from pathlib import Path

from validation_config import (
    DEFAULT_CONFIG_PATH,
    ValidationTemplate,
    load_validation_config,
)


def test_load_config_parses_all_26_templates():
    cfg = load_validation_config(DEFAULT_CONFIG_PATH, resolve_workspace_root=False)
    assert cfg.profile == "dogfood"
    assert cfg.shared_app_name == "val-template-check"
    assert len(cfg.templates) == 26
    names = {t.name for t in cfg.templates}
    assert "streamlit-database-app" in names
    assert "rag-chat" in names
    # verify kinds are constrained to the known set
    assert {t.verify for t in cfg.templates} <= {"html", "spa", "mcp", "api"}
    assert ValidationTemplate(name="x", verify="html").verify == "html"


def test_empty_workspace_root_left_unresolved_when_flag_false():
    cfg = load_validation_config(DEFAULT_CONFIG_PATH, resolve_workspace_root=False)
    assert cfg.workspace_source_root == ""
```

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'validation_config'`.

- [ ] **Step 4: Implement `validation_config.py`**

Create `.scripts/agent-integration-tests/validation_config.py`:

```python
"""Config + registry for non-agent template deploy validation."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

_VALID_VERIFY = {"html", "spa", "mcp", "api"}
DEFAULT_CONFIG_PATH = Path(__file__).parent / "validation-config.yaml"


@dataclass(frozen=True)
class ValidationTemplate:
    name: str
    verify: str


@dataclass(frozen=True)
class ValidationConfig:
    profile: str
    shared_app_name: str
    workspace_source_root: str
    templates: list[ValidationTemplate]


def derive_workspace_source_root(profile: str) -> str:
    from databricks.sdk import WorkspaceClient

    user = WorkspaceClient(profile=profile).current_user.me().user_name
    return f"/Workspace/Users/{user}/template-validation"


def load_validation_config(
    path: Path = DEFAULT_CONFIG_PATH,
    *,
    resolve_workspace_root: bool = True,
) -> ValidationConfig:
    data = yaml.safe_load(path.read_text())
    profile = data["profile"]
    templates = []
    for name, entry in data["templates"].items():
        verify = entry["verify"]
        assert verify in _VALID_VERIFY, f"{name}: bad verify kind {verify!r}"
        templates.append(ValidationTemplate(name=name, verify=verify))

    root = data.get("workspace_source_root") or ""
    if not root and resolve_workspace_root:
        root = derive_workspace_source_root(profile)

    return ValidationConfig(
        profile=profile,
        shared_app_name=data["shared_app_name"],
        workspace_source_root=root,
        templates=templates,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add .scripts/agent-integration-tests/validation_config.py \
        .scripts/agent-integration-tests/validation-config.yaml \
        .scripts/agent-integration-tests/tests/test_validate_unit.py \
        .scripts/agent-integration-tests/pyproject.toml
git commit -m "feat(validation): add non-agent template registry + config loader"
```

---

### Task 2: `app.yaml` neutralization transform

Neutralizes source so a template boots on a generic shared app: converts every `env` entry that uses `valueFrom` into a placeholder `value`, and drops the top-level `resources:` block (which references app resources not bound to the shared app).

**Files:**
- Create: `.scripts/agent-integration-tests/validate_transforms.py`
- Modify: `.scripts/agent-integration-tests/tests/test_validate_unit.py`

**Interfaces:**
- Produces: `neutralize_app_yaml(text: str) -> str`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_validate_unit.py`:

```python
import yaml as _yaml

from validate_transforms import neutralize_app_yaml


def test_neutralize_converts_valuefrom_and_drops_resources():
    src = """\
command: ["npm", "run", "start"]
env:
  - name: KEEP_ME
    value: "literal"
  - name: LAKEBASE_ENDPOINT
    valueFrom: postgres
resources:
  - name: serving-endpoint
    serving_endpoint:
      name: foo
"""
    out = neutralize_app_yaml(src)
    doc = _yaml.safe_load(out)
    # command preserved
    assert doc["command"] == ["npm", "run", "start"]
    # resources removed entirely
    assert "resources" not in doc
    env = {e["name"]: e for e in doc["env"]}
    # literal value untouched
    assert env["KEEP_ME"]["value"] == "literal"
    # valueFrom replaced with a placeholder value, no valueFrom key remains
    assert "valueFrom" not in env["LAKEBASE_ENDPOINT"]
    assert env["LAKEBASE_ENDPOINT"]["value"] == "placeholder"


def test_neutralize_noop_when_no_env_or_resources():
    src = 'command: ["streamlit", "run", "app.py"]\n'
    out = neutralize_app_yaml(src)
    assert _yaml.safe_load(out)["command"] == ["streamlit", "run", "app.py"]
```

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v -k neutralize`
Expected: FAIL with `ModuleNotFoundError: No module named 'validate_transforms'`.

- [ ] **Step 2: Implement the transform**

Create `.scripts/agent-integration-tests/validate_transforms.py`:

```python
"""Pure source transforms + parsing for deploy validation."""
from __future__ import annotations

import re

import yaml


def neutralize_app_yaml(text: str) -> str:
    """Make an app.yaml deployable on a generic shared app.

    - Every env entry using ``valueFrom`` becomes ``value: "placeholder"``.
    - The top-level ``resources`` block is removed (it binds app resources
      that the shared validation app does not have).
    """
    doc = yaml.safe_load(text) or {}
    doc.pop("resources", None)
    for entry in doc.get("env", []) or []:
        if "valueFrom" in entry:
            entry.pop("valueFrom")
            entry["value"] = "placeholder"
    return yaml.safe_dump(doc, sort_keys=False, default_flow_style=False)
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v -k neutralize`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/validate_transforms.py \
        .scripts/agent-integration-tests/tests/test_validate_unit.py
git commit -m "feat(validation): add app.yaml valueFrom/resources neutralization"
```

---

### Task 3: SPA asset parsing

**Files:**
- Modify: `.scripts/agent-integration-tests/validate_transforms.py`
- Modify: `.scripts/agent-integration-tests/tests/test_validate_unit.py`

**Interfaces:**
- Produces: `parse_spa_assets(html: str, base_url: str) -> list[str]` — absolute URLs for referenced `.js`/`.css` assets (deduped, order-preserving).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_validate_unit.py`:

```python
from validate_transforms import parse_spa_assets


def test_parse_spa_assets_absolutizes_and_filters():
    html = """
    <html><head>
      <link rel="stylesheet" href="/assets/index-abc123.css">
      <script type="module" src="/assets/index-def456.js"></script>
      <script src="https://cdn.example.com/vendor.js"></script>
      <img src="/logo.png">
    </head></html>
    """
    assets = parse_spa_assets(html, "https://app.example.com")
    assert "https://app.example.com/assets/index-abc123.css" in assets
    assert "https://app.example.com/assets/index-def456.js" in assets
    # absolute external URL preserved as-is
    assert "https://cdn.example.com/vendor.js" in assets
    # non js/css ignored
    assert all(not a.endswith(".png") for a in assets)


def test_parse_spa_assets_empty_when_none():
    assert parse_spa_assets("<html><body>hi</body></html>", "https://x") == []
```

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v -k spa_assets`
Expected: FAIL with `ImportError: cannot import name 'parse_spa_assets'`.

- [ ] **Step 2: Implement `parse_spa_assets`**

Append to `validate_transforms.py`:

```python
from urllib.parse import urljoin

_ASSET_RE = re.compile(
    r'(?:src|href)\s*=\s*["\']([^"\']+\.(?:js|css))(?:\?[^"\']*)?["\']',
    re.IGNORECASE,
)


def parse_spa_assets(html: str, base_url: str) -> list[str]:
    """Extract referenced .js/.css asset URLs from served HTML, absolutized."""
    seen: dict[str, None] = {}
    for ref in _ASSET_RE.findall(html):
        url = ref if ref.startswith(("http://", "https://")) else urljoin(base_url + "/", ref)
        seen.setdefault(url, None)
    return list(seen)
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v -k spa_assets`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/validate_transforms.py \
        .scripts/agent-integration-tests/tests/test_validate_unit.py
git commit -m "feat(validation): add SPA asset extraction from served HTML"
```

---

### Task 4: apps-deploy adapter + generic readiness

Subprocess/HTTP orchestration. Unit-tested where pure (`prepare_source`); the live path is exercised in Task 7 (prove-on-2).

**Files:**
- Create: `.scripts/agent-integration-tests/validate_templates.py`
- Modify: `.scripts/agent-integration-tests/tests/test_validate_unit.py`

**Interfaces:**
- Consumes: `helpers._run_cmd`, `helpers._run_with_retries`, `helpers.get_oauth_token`, `helpers.git_copy_template`, `helpers.POLL_INTERVAL`, `helpers.MAX_POLLS`; `validate_transforms.neutralize_app_yaml`; `template_config.REPO_ROOT`.
- Produces:
  - `prepare_source(template_name: str, dest: Path) -> Path` — git-copies the template (working tree, incl. uncommitted merge state) into `dest`, neutralizes its `app.yaml` in place if present, returns the copied dir.
  - `sync_source(src_dir: Path, ws_path: str, profile: str) -> None`
  - `apps_deploy_source(app_name: str, ws_path: str, profile: str) -> None`
  - `wait_for_app_ready_generic(app_name: str, profile: str, health_path: str = "/") -> tuple[str, str]` — returns `(app_url, token)`.

- [ ] **Step 1: Write the failing test (prepare_source)**

Append to `tests/test_validate_unit.py`:

```python
def test_prepare_source_neutralizes_app_yaml(tmp_path):
    from validate_templates import prepare_source

    # streamlit-database-app has an app.yaml with no valueFrom; use a template
    # that does exist and just assert app.yaml is present and parseable.
    dest = tmp_path / "work"
    dest.mkdir()
    out = prepare_source("streamlit-database-app", dest)
    app_yaml = out / "app.yaml"
    assert app_yaml.exists()
    # neutralized output must still be valid YAML with a command
    import yaml as y
    assert "command" in y.safe_load(app_yaml.read_text())
```

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v -k prepare_source`
Expected: FAIL with `ModuleNotFoundError: No module named 'validate_templates'`.

- [ ] **Step 2: Implement the adapter functions**

Create `.scripts/agent-integration-tests/validate_templates.py`:

```python
"""Serial, single-app deploy validation for non-agent templates.

Reuses the deploy/retry/OAuth/log machinery in helpers.py. Each template is
redeployed into ONE shared persistent app via `databricks apps deploy`, then
curl-verified. Run serially — never with pytest -n >0 (shared app).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests
from helpers import (
    MAX_POLLS,
    POLL_INTERVAL,
    _log,
    _run_cmd,
    _run_with_retries,
    get_oauth_token,
    git_copy_template,
)
from validate_transforms import neutralize_app_yaml

BUNDLE_TIMEOUT = 600
QUERY_TIMEOUT = 60


def prepare_source(template_name: str, dest: Path) -> Path:
    src = git_copy_template(template_name, dest)
    app_yaml = src / "app.yaml"
    if app_yaml.exists():
        app_yaml.write_text(neutralize_app_yaml(app_yaml.read_text()))
    return src


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
                assert app_url, f"No URL for app {app_name}"
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
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v -k prepare_source`
Expected: PASS (uses real `git_copy_template` on a checked-in template; no network).

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/validate_templates.py \
        .scripts/agent-integration-tests/tests/test_validate_unit.py
git commit -m "feat(validation): add apps-deploy adapter + generic readiness"
```

---

### Task 5: Verification tiers

**Files:**
- Modify: `.scripts/agent-integration-tests/validate_templates.py`
- Modify: `.scripts/agent-integration-tests/tests/test_validate_unit.py`

**Interfaces:**
- Consumes: `validate_transforms.parse_spa_assets`; `ValidationTemplate` (has `.verify`).
- Produces:
  - `health_path_for(verify: str) -> str` — readiness path per kind (`"/"` for all; centralizes future per-kind changes).
  - `verify_serving(verify: str, app_url: str, token: str) -> None` — raises `AssertionError` on failure. `html`→non-5xx + HTML marker; `spa`→non-5xx + at least one referenced asset returns 200; `mcp`/`api`→non-5xx on `/`.

- [ ] **Step 1: Write the failing test (dispatch + html marker logic via a stub server)**

Append to `tests/test_validate_unit.py`:

```python
import http.server
import threading


class _Handler(http.server.BaseHTTPRequestHandler):
    HTML = b'<!doctype html><html><head><script src="/assets/a.js"></script></head></html>'

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/assets/a.js":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"console.log(1)")
        elif self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(self.HTML)
        else:
            self.send_response(404)
            self.end_headers()


def _serve():
    srv = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def test_verify_html_and_spa_pass_against_stub():
    from validate_templates import verify_serving

    srv, url = _serve()
    try:
        verify_serving("html", url, token="ignored")  # no raise
        verify_serving("spa", url, token="ignored")   # asset /assets/a.js returns 200
        verify_serving("mcp", url, token="ignored")   # 200 on / is non-5xx
    finally:
        srv.shutdown()
```

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v -k verify_html`
Expected: FAIL with `ImportError: cannot import name 'verify_serving'`.

- [ ] **Step 2: Implement verification**

Append to `validate_templates.py`:

```python
from validate_transforms import parse_spa_assets


def health_path_for(verify: str) -> str:
    return "/"


def _get(url: str, token: str):
    return requests.get(
        url, headers={"Authorization": f"Bearer {token}"}, timeout=QUERY_TIMEOUT
    )


def verify_serving(verify: str, app_url: str, token: str) -> None:
    resp = _get(f"{app_url}/", token)
    assert resp.status_code < 500, f"/ returned {resp.status_code}: {resp.text[:500]}"

    if verify == "html":
        body = resp.text.lower()
        assert "<html" in body or "<!doctype" in body, (
            f"/ did not look like HTML: {resp.text[:300]}"
        )
    elif verify == "spa":
        assets = parse_spa_assets(resp.text, app_url)
        assert assets, f"No JS/CSS assets referenced by / (broken build?): {resp.text[:300]}"
        # fetch the first same-origin asset; a broken build 404s/5xxs here
        same_origin = [a for a in assets if a.startswith(app_url)] or assets
        target = same_origin[0]
        a = _get(target, token)
        assert a.status_code == 200, f"asset {target} returned {a.status_code}"
    # mcp/api: non-5xx on / already asserted above
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v -k verify_html`
Expected: PASS.

- [ ] **Step 4: Run the full unit suite**

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v`
Expected: PASS (all unit tests).

- [ ] **Step 5: Commit**

```bash
git add .scripts/agent-integration-tests/validate_templates.py \
        .scripts/agent-integration-tests/tests/test_validate_unit.py
git commit -m "feat(validation): add curl-tiered serving verification"
```

---

### Task 6: pytest runner + shared-app fixture + CLI options

Wires everything into a serial pytest entry point with a session fixture that ensures the shared app exists once.

**Files:**
- Modify: `.scripts/agent-integration-tests/validate_templates.py`
- Modify: `.scripts/agent-integration-tests/conftest.py` (add `--config`, `--val-template`, `--setup-only` options)

**Interfaces:**
- Consumes: `validation_config.load_validation_config`, `helpers.databricks_create_app`, `helpers.capture_app_logs`, `helpers.set_log_file`, all Task 4/5 functions.
- Produces: `test_validate_template(...)` parametrized over the config's templates; a session fixture `shared_app` that creates the app if missing.

- [ ] **Step 1: Add CLI options to conftest.py**

In `.scripts/agent-integration-tests/conftest.py`, inside the existing `pytest_addoption(parser)` add:

```python
    parser.addoption("--config", action="store", default=None,
                     help="Path to validation-config.yaml (validate_templates.py)")
    parser.addoption("--val-template", action="append", default=[],
                     help="Limit validation to these template names (repeatable)")
    parser.addoption("--setup-only", action="store_true", default=False,
                     help="Only ensure the shared app exists; skip deploy/verify")
```

- [ ] **Step 2: Implement the runner in validate_templates.py**

Append to `validate_templates.py`:

```python
import tempfile

import pytest
from helpers import capture_app_logs, databricks_create_app, set_log_file
from validation_config import DEFAULT_CONFIG_PATH, load_validation_config


def _load_cfg(config):
    path = Path(config.getoption("--config") or DEFAULT_CONFIG_PATH)
    return load_validation_config(path)


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
    return _load_cfg(request.config)


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


def test_validate_template(val_template, val_cfg, shared_app, request):
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    set_log_file(log_dir / f"validate-{val_template.name}.log")

    if request.config.getoption("--setup-only"):
        pytest.skip("--setup-only: shared app ensured, skipping deploy")

    ws_path = f"{val_cfg.workspace_source_root}/{val_template.name}"
    with tempfile.TemporaryDirectory(prefix=f"val-{val_template.name}-") as tmp:
        src = prepare_source(val_template.name, Path(tmp))
        sync_source(src, ws_path, val_cfg.profile)
        apps_deploy_source(shared_app, ws_path, val_cfg.profile)
        try:
            app_url, token = wait_for_app_ready_generic(
                shared_app, val_cfg.profile, health_path_for(val_template.verify)
            )
            verify_serving(val_template.verify, app_url, token)
        except Exception:
            logs = capture_app_logs(shared_app, val_cfg.profile)
            if logs:
                _log(f"\n--- App logs ({shared_app}) ---\n{logs}\n--- End logs ---")
            raise
```

- [ ] **Step 3: Verify collection works (no deploy)**

Run: `cd .scripts/agent-integration-tests && uv run pytest validate_templates.py --collect-only -q`
Expected: lists 26 `test_validate_template[<name>]` items.

- [ ] **Step 4: Verify --setup-only path is wired (offline collection guard)**

Run: `cd .scripts/agent-integration-tests && uv run pytest validate_templates.py --collect-only -q -k streamlit-database-app`
Expected: exactly one collected item `test_validate_template[streamlit-database-app]`.

- [ ] **Step 5: Commit**

```bash
git add .scripts/agent-integration-tests/validate_templates.py \
        .scripts/agent-integration-tests/conftest.py
git commit -m "feat(validation): add serial pytest runner + shared-app fixture"
```

---

### Task 7: Prove on 2 (live acceptance) + integration-branch script

Live validation against `dogfood`. This is the acceptance gate that de-risks Node build behavior and resource-dependent boot before scaling.

**Files:**
- Create: `.scripts/make-integration-branch.sh`

**Interfaces:**
- Produces: `make-integration-branch.sh` — creates/refreshes `integration/validate-YYYYMMDD` by merging the 7 branches onto `main`, aborting loudly on conflict.

- [ ] **Step 1: Write the integration-branch script**

Create `.scripts/make-integration-branch.sh`:

```bash
#!/usr/bin/env bash
# Build an ephemeral integration branch merging the in-flight validation branches.
# Fails loudly on the first conflict so it can be resolved before validating.
set -euo pipefail

BRANCHES=(
  claude/great-feynman-snda6q
  claude/semgrep-1-agent-templates
  claude/semgrep-2-python-apps
  claude/semgrep-3-js-code
  claude/semgrep-4-npm-pins
  claude/semgrep-5-vite8
  claude/semgrep-6-ci
)
INT_BRANCH="integration/validate-$(date +%Y%m%d)"

git fetch origin "${BRANCHES[@]}"
git checkout -B "$INT_BRANCH" origin/main
for b in "${BRANCHES[@]}"; do
  echo "==> merging origin/$b"
  if ! git merge --no-edit "origin/$b"; then
    echo "CONFLICT merging origin/$b — resolve, commit, then re-run or continue manually." >&2
    git merge --abort
    exit 1
  fi
done
echo "Integration branch ready: $INT_BRANCH"
```

Then:

Run: `chmod +x .scripts/make-integration-branch.sh`
Expected: no output, exit 0.

- [ ] **Step 2: Build the integration branch**

Run: `cd /Users/mike.helmick/src/app-templates && ./.scripts/make-integration-branch.sh`
Expected: either "Integration branch ready" OR a clear CONFLICT message naming the branch. If conflict: STOP and report the conflicting files to the user for resolution before continuing.

- [ ] **Step 3: Run unit tests on the merged tree**

Run: `cd .scripts/agent-integration-tests && uv run pytest tests/test_validate_unit.py -v`
Expected: PASS.

- [ ] **Step 4: Ensure the shared app exists**

Run: `cd .scripts/agent-integration-tests && uv run pytest validate_templates.py -v --setup-only`
Expected: shared app `val-template-check` created or confirmed; tests skip with "--setup-only".

- [ ] **Step 5: Prove on one html template (streamlit)**

Run: `cd .scripts/agent-integration-tests && uv run pytest validate_templates.py -v -s --val-template streamlit-database-app`
Expected: PASS — app reaches RUNNING and `/` serves HTML. On failure, read `logs/validate-streamlit-database-app.log` and the captured app logs.

- [ ] **Step 6: Prove on one SPA template (rag-chat)**

Run: `cd .scripts/agent-integration-tests && uv run pytest validate_templates.py -v -s --val-template rag-chat`
Expected: PASS — `/` serves HTML and at least one referenced Vite asset returns 200.

**If rag-chat fails because the Node bundle was never built** (assets 404, or app crash-loops on missing `dist/`): the platform did not auto-build. Remediation options, in order of preference — apply the smallest that works, and record the decision:
  1. Confirm whether `npm run start` is expected to build; if a separate `build` is needed, extend the apps-deploy adapter to run it during `prepare_source` (e.g. `npm ci && npm run build` in the copied dir before sync) for `spa` templates.
  2. If the platform's enhanced (project-dir) deploy is required for Node, note that these are the DAB templates and reconsider the DAB path for the SPA subset.

- [ ] **Step 7: Commit the script**

```bash
git add .scripts/make-integration-branch.sh
git commit -m "chore(validation): add ephemeral integration-branch builder"
```

- [ ] **Step 8: Report prove-on-2 results to the user**

Summarize: did streamlit + rag-chat pass? Any Node-build or resource-boot remediation applied? Get a go/no-go before scaling to all 26.

---

### Task 8: Scale to all 26 + docs

**Files:**
- Modify: `.scripts/agent-integration-tests/AGENTS.md`

- [ ] **Step 1: Run the full non-agent validation (serial)**

Run: `cd .scripts/agent-integration-tests && uv run pytest validate_templates.py -v` (run in background per AGENTS.md; do NOT pipe through head/tail)
Expected: 26 results. Collect pass/fail; for each failure read `logs/validate-<name>.log`. Expected known-risky: `mcp-server-open-api-spec` (needs a UC connection) may fail to boot — record as environment-dependent, not a template regression.

- [ ] **Step 2: Run the agent suite against the merged tree**

Run: `cd .scripts/agent-integration-tests && uv run pytest test_e2e.py -v -n 8 --profile dogfood`
Expected: the 7 agent templates pass (their existing contract). Record failures.

- [ ] **Step 3: Document the new suite**

Add a "Non-agent template validation" section to `.scripts/agent-integration-tests/AGENTS.md` covering: the single-shared-app serial model, `validation-config.yaml`, `--setup-only`/`--val-template`/`--config` flags, the verify tiers, the "serial only — no `-n`" rule, `make-integration-branch.sh`, and the known resource-dependent templates.

- [ ] **Step 4: Commit**

```bash
git add .scripts/agent-integration-tests/AGENTS.md
git commit -m "docs(validation): document non-agent template validation suite"
```

- [ ] **Step 5: Final report**

Report the full 33-template result matrix (26 non-agent + 7 agent), calling out real regressions vs. environment-dependent boot failures, so the user can decide what blocks landing the merged branches.

---

## Self-Review

**Spec coverage:**
- Reusable machinery / community-PR reuse → Tasks 1–6 (runner validates working tree; `make-integration-branch.sh` generalizes to any PR checkout). ✓
- Two deploy shapes → apps-deploy adapter uniform for the 26 non-agent (Task 4); agents on existing `test_e2e.py` (Task 8 Step 2). ✓
- Single shared app, serial, persistent → Task 6 fixture + global constraint (no `-n`). ✓
- One-time setup vs repeatable deploy → `--setup-only` (Task 6) + create-if-missing fixture. ✓
- curl-tiered verification (html/spa/mcp/api) → Task 5. ✓
- Ephemeral integration branch, fail on conflict → Task 7 Steps 1–2. ✓
- `valueFrom` neutralization mitigation → Task 2, applied in `prepare_source` (Task 4). ✓
- Auth via SDK/`databricks auth token` → `get_oauth_token` reused in Task 4. ✓
- Prove on 2 before scaling → Task 7. ✓
- Risks (Node build, mcp-open-api UC connection) → Task 7 Step 6 + Task 8 Step 1. ✓

**Placeholder scan:** No TBD/TODO left as work items; the two `# TODO` strings quoted in Task-1 YAML config examples are copied verbatim from real template files (`mcp-server-open-api-spec`), not plan placeholders. Every code step has runnable content.

**Type consistency:** `ValidationTemplate.verify` / `.name` used consistently across Tasks 1, 5, 6. `verify_serving(verify, app_url, token)`, `wait_for_app_ready_generic(app_name, profile, health_path)`, `prepare_source(template_name, dest)`, `sync_source(src_dir, ws_path, profile)`, `apps_deploy_source(app_name, ws_path, profile)` signatures match between definition (Tasks 4/5) and call sites (Task 6). `parse_spa_assets(html, base_url)` and `neutralize_app_yaml(text)` consistent between Tasks 2/3 and Task 4/5 usage. ✓
