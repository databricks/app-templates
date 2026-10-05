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
