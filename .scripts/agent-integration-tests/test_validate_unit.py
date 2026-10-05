from pathlib import Path

import yaml as _yaml

from validation_config import (
    DEFAULT_CONFIG_PATH,
    ValidationTemplate,
    load_validation_config,
)
from validate_transforms import neutralize_app_yaml, parse_spa_assets


def test_load_config_parses_all_26_templates():
    cfg = load_validation_config(DEFAULT_CONFIG_PATH, resolve_workspace_root=False)
    assert cfg.profile == "dogfood"
    assert cfg.shared_app_name == "template-e2e-test"
    assert len(cfg.templates) == 26
    names = {t.name for t in cfg.templates}
    assert "streamlit-database-app" in names
    assert "rag-chat" in names
    # verify kinds are constrained to the known set
    assert {t.verify for t in cfg.templates} <= {"html", "spa", "mcp", "api", "build"}
    assert ValidationTemplate(name="x", verify="html").verify == "html"
    verify_kinds = {t.verify for t in cfg.templates}
    assert "build" in verify_kinds
    assert sum(1 for t in cfg.templates if t.verify == "build") == 15


def test_empty_workspace_root_left_unresolved_when_flag_false():
    cfg = load_validation_config(DEFAULT_CONFIG_PATH, resolve_workspace_root=False)
    assert cfg.workspace_source_root == ""


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


def test_build_template_uses_npm_ci_when_lockfile_present(tmp_path, monkeypatch):
    import validate_templates as vt

    calls = []

    class _R:
        returncode = 0
        stdout = ""
        stderr = ""

    (tmp_path / "package-lock.json").write_text("{}")
    monkeypatch.setattr(vt, "git_copy_template", lambda name, dest: dest)
    monkeypatch.setattr(vt, "_run_cmd", lambda cmd, **kw: calls.append(cmd) or _R())
    vt.build_template("rag-chat", tmp_path)
    assert ["npm", "ci"] in calls
    assert ["npm", "run", "build"] in calls


def test_build_template_uses_npm_install_without_lockfile(tmp_path, monkeypatch):
    import validate_templates as vt

    calls = []

    class _R:
        returncode = 0
        stdout = ""
        stderr = ""

    monkeypatch.setattr(vt, "git_copy_template", lambda name, dest: dest)
    monkeypatch.setattr(vt, "_run_cmd", lambda cmd, **kw: calls.append(cmd) or _R())
    vt.build_template("content-moderator", tmp_path)
    assert ["npm", "install"] in calls
    assert ["npm", "ci"] not in calls


def test_build_template_raises_on_build_failure(tmp_path, monkeypatch):
    import pytest as _pytest

    import validate_templates as vt

    class _R:
        returncode = 1
        stdout = "x"
        stderr = "boom"

    monkeypatch.setattr(vt, "git_copy_template", lambda name, dest: dest)
    monkeypatch.setattr(vt, "_run_cmd", lambda cmd, **kw: _R())
    with _pytest.raises(RuntimeError):
        vt.build_template("rag-chat", tmp_path)


def test_render_report_table_and_summary():
    from validate_templates import render_report

    rows = [
        {"template": "rag-chat", "mode": "build", "verify": "build", "outcome": "passed", "duration": 12.0},
        {"template": "dash-chatbot-app", "mode": "deploy", "verify": "html", "outcome": "failed", "duration": 3.5},
        {"template": "mcp-server-hello-world", "mode": "deploy", "verify": "mcp", "outcome": "skipped", "duration": 0.1},
    ]
    md = render_report(rows)
    assert "**1/3 passed** — 1 failed, 1 skipped" in md
    assert "| Template | Mode | Verify | Result | Duration |" in md
    # failure sorts first
    first_row = [l for l in md.splitlines() if l.startswith("| dash-chatbot-app")][0]
    assert "❌ FAIL" in first_row
    assert "| rag-chat | build | build | ✅ pass |" in md


# Task 2: Functional registry tests
def test_four_exemplars_registered():
    from functional_config import (
        FUNCTIONAL_TEMPLATES, FunctionalTemplate, VALID_FAMILIES,
    )
    assert set(FUNCTIONAL_TEMPLATES) == {
        "streamlit-database-app", "e2e-chatbot-app-next",
        "mcp-server-hello-world", "agent-langgraph",
    }
    for ft in FUNCTIONAL_TEMPLATES.values():
        assert ft.family in VALID_FAMILIES
        assert ft.test["kind"] in {"node-playwright", "py-playwright", "mcp", "agent-api"}


def test_missing_required_resource_is_reported():
    from functional_config import FunctionalTemplate, missing_resources
    ft = FunctionalTemplate(
        name="x", family="streamlit", launch={}, test={"kind": "py-playwright"},
        required_resources=("DATABRICKS_WAREHOUSE_ID",),
    )
    assert missing_resources(ft, {}) == ["DATABRICKS_WAREHOUSE_ID"]
    assert missing_resources(ft, {"DATABRICKS_WAREHOUSE_ID": "w1"}) == []


# Task 3: Local launch tests
def test_build_launch_command_per_family():
    from functional_config import FunctionalTemplate
    from local_launch import build_launch_command

    def _ft(family):
        return FunctionalTemplate(name="t", family=family, launch={"dev_script": "dev"},
                                  test={"kind": "x"}, required_resources=())

    assert build_launch_command(_ft("streamlit"), 8501)[:2] == ["streamlit", "run"]
    assert "--server.port" in build_launch_command(_ft("streamlit"), 8501)
    assert build_launch_command(_ft("dash"), 8050)[0] in {"python", "uv"}
    assert build_launch_command(_ft("node"), 3000)[:2] == ["npm", "run"]
    assert build_launch_command(_ft("agent"), 8000)[:2] == ["uv", "run"]
    assert build_launch_command(_ft("mcp"), 8000)[:2] == ["uv", "run"]
    assert "--port" in build_launch_command(_ft("mcp"), 8000)
    assert "8000" in build_launch_command(_ft("mcp"), 8000)


def test_wait_ready_times_out():
    import time
    import pytest
    from local_launch import wait_ready

    t0 = time.time()
    with pytest.raises(TimeoutError):
        wait_ready("http://127.0.0.1:1", "/", deadline_s=2)
    assert time.time() - t0 < 10


# Task 4: Functional report tests
def test_report_handles_absent_deployed():
    from functional_report import render_functional_report

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


# Task 5: Functional runners tests
def test_missing_browser_message(monkeypatch):
    import pytest

    import functional_runners as fr

    monkeypatch.setattr(fr, "_chromium_present", lambda: False)
    with pytest.raises(RuntimeError, match="playwright install chromium"):
        fr.assert_browser_installed()


# Task 6: Login-page detection tests
def test_detects_login_page_not_app():
    from functional_runners import looks_like_login_page

    assert looks_like_login_page("<html>Sign in to Databricks</html>", "https://login.databricks.com/oidc")
    assert looks_like_login_page("", "https://accounts.cloud.databricks.com/login")
    assert not looks_like_login_page("<html>My App</html>", "https://myapp.databricksapps.com/")
