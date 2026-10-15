from pathlib import Path

import yaml as _yaml

from validation_config import (
    DEFAULT_CONFIG_PATH,
    ValidationTemplate,
    load_validation_config,
)
from validate_transforms import neutralize_app_yaml, parse_spa_assets


def test_load_config_parses_all_templates():
    cfg = load_validation_config(DEFAULT_CONFIG_PATH, resolve_workspace_root=False)
    assert cfg.profile == "dogfood"
    assert cfg.shared_app_name == "template-e2e-test"
    # Drift-proof: parsed count matches the raw yaml (no silent drop/dupe), rather
    # than a hardcoded number that goes stale every time a template is added.
    raw = _yaml.safe_load(DEFAULT_CONFIG_PATH.read_text())["templates"]
    assert len(cfg.templates) == len(raw)
    names = {t.name for t in cfg.templates}
    assert {"streamlit-database-app", "rag-chat", "e2e-chatbot-model-service"} <= names
    # verify kinds are constrained to the known set
    assert {t.verify for t in cfg.templates} <= {"html", "spa", "mcp", "api", "build", "obo"}
    assert ValidationTemplate(name="x", verify="spa").verify == "spa"
    # the newest template is build-verified
    model_svc = next(t for t in cfg.templates if t.name == "e2e-chatbot-model-service")
    assert model_svc.verify == "build"
    # every html template must carry an expect signal (loader enforces this)
    assert all(t.expect for t in cfg.templates if t.verify == "html")


def test_obo_wiring_expect_and_click():
    cfg = load_validation_config(DEFAULT_CONFIG_PATH, resolve_workspace_root=False)
    obo = {t.name: t for t in cfg.templates if t.verify == "obo"}
    # The 4 data-app-obo-user templates are wired (declare a success-signal expect);
    # obo entries without expect are intentionally skipped at runtime (not yet wired).
    wired = {n for n, t in obo.items() if t.expect}
    assert wired == {
        "streamlit-data-app-obo-user",
        "dash-data-app-obo-user",
        "gradio-data-app-obo-user",
        "shiny-data-app-obo-user",
    }
    # Interaction-gated apps carry an obo_click control; on-load apps don't.
    assert obo["gradio-data-app-obo-user"].obo_click == "Run Query"
    assert obo["shiny-data-app-obo-user"].obo_click == "Run Query"
    assert obo["streamlit-data-app-obo-user"].obo_click is None
    assert obo["dash-data-app-obo-user"].obo_click is None


def test_obo_click_only_valid_for_obo(tmp_path):
    import pytest as _pytest

    bad = tmp_path / "c.yaml"
    bad.write_text(
        "profile: p\nshared_app_name: a\nworkspace_source_root: ''\n"
        "templates:\n  x: { verify: html, expect: 'Hi', obo_click: 'Go' }\n"
    )
    with _pytest.raises(AssertionError, match="obo_click is only valid"):
        load_validation_config(bad, resolve_workspace_root=False)


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


def test_assert_html_rendered_passes_with_expected_content():
    from validate_templates import assert_html_rendered

    html = (
        "<!doctype html><html><body><h1>Todo List App</h1>"
        + "x" * 600
        + "</body></html>"
    )
    assert_html_rendered(html, ["Todo List App"])  # no raise
    assert_html_rendered(html, ["todo list app"])  # case-insensitive


def test_assert_html_rendered_fails_on_generic_shell():
    import pytest as _pytest

    from validate_templates import assert_html_rendered

    # A framework shell / error page: valid HTML, long enough, but the app's own
    # content never rendered. This is the exact false-pass the expect signal guards.
    shell = (
        "<!doctype html><html><head><title>Streamlit</title></head><body>"
        + "x" * 600
        + "</body></html>"
    )
    with _pytest.raises(AssertionError):
        assert_html_rendered(shell, ["Todo List App"])


def test_assert_html_rendered_fails_on_too_short_or_non_html():
    import pytest as _pytest

    from validate_templates import assert_html_rendered

    with _pytest.raises(AssertionError):
        assert_html_rendered("<html>hi</html>", ["hi"])  # too short (login-shell size)
    with _pytest.raises(AssertionError):
        assert_html_rendered("{\"error\": \"not found\"}" + "x" * 600, ["app"])  # not HTML


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
    assert "**Local:** 1 passed · 0 skipped · 1 failed" in md
    assert "**Deployed:** not run" in md


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


def test_deploy_recover_caps_build_failures(monkeypatch):
    import validate_templates as vt

    monkeypatch.setattr(vt.time, "sleep", lambda _s: None)
    build_err = "Error: failed to reach SUCCEEDED, got FAILED: Error building app."
    assert vt._deploy_recover(build_err, 1, 10) is True   # one retry for a blip
    assert vt._deploy_recover(build_err, 2, 10) is False  # then give up
    assert vt._deploy_recover("transient 503", 2, 10) is True
    assert vt._deploy_recover("transient 503", 10, 10) is False


def test_build_log_entries_extracts_build_rows_oldest_first():
    from validate_templates import build_log_entries

    page = (
        '<tbody id="logTBody">'
        '<tr class="log-entry" data-source="BUILD"><td>t2</td><td>BUILD</td>'
        '<td><div>permission denied for schema &quot;drizzle&quot;</div></td></tr>'
        '<tr class="log-entry" data-source="APP"><td>t1</td><td>APP</td><td>app line</td></tr>'
        '<tr class="log-entry" data-source="BUILD"><td>t0</td><td>BUILD</td>'
        '<td>&gt; npm run build</td></tr>'
        '</tbody>'
    )
    assert build_log_entries(page) == ["> npm run build", 'permission denied for schema "drizzle"']


def test_deploy_recover_caps_crash_on_start(monkeypatch):
    import validate_templates as vt

    monkeypatch.setattr(vt.time, "sleep", lambda _s: None)
    crash = "got FAILED: Error: app exited unexpectedly. Please check /logz"
    assert vt._deploy_recover(crash, 1, 10) is True
    assert vt._deploy_recover(crash, 2, 10) is False


def test_resource_aware_app_yaml_aliases_files_to_shared_uc_volume():
    from validate_transforms import resource_aware_app_yaml

    out = _yaml.safe_load(resource_aware_app_yaml(
        "command: [npm, start]\n"
        "env:\n"
        "  - name: DATABRICKS_VOLUME_FILES\n    valueFrom: files\n"
        "  - name: DATABRICKS_WAREHOUSE_ID\n    valueFrom: sql-warehouse\n"
        "resources:\n  - name: files\n"
    ))
    assert "resources" not in out
    assert [e["valueFrom"] for e in out["env"]] == ["uc-volume", "sql-warehouse"]


def test_force_build_env_unified_host(monkeypatch):
    import validate_templates as vt

    monkeypatch.setattr(vt, "_shared_app_warehouse_id", lambda _a, _p: "wh1")
    monkeypatch.setattr(vt, "_profile_workspace_id", lambda _p: "123")
    assert vt.force_build_env("app", "dogfood") == {
        "DATABRICKS_CONFIG_PROFILE": "dogfood",
        "DATABRICKS_WAREHOUSE_ID": "wh1",
        "DATABRICKS_WORKSPACE_ID": "123",
        "DATABRICKS_EXPERIMENTAL_IS_UNIFIED_HOST": "true",
    }


def test_force_build_env_plain_host_without_warehouse(monkeypatch):
    import validate_templates as vt

    monkeypatch.setattr(vt, "_shared_app_warehouse_id", lambda _a, _p: "")
    monkeypatch.setattr(vt, "_profile_workspace_id", lambda _p: "")
    assert vt.force_build_env("app", "dev") == {"DATABRICKS_CONFIG_PROFILE": "dev"}


def test_chatbot_ui_dir_finds_consumers(tmp_path):
    import validate_templates as vt

    agent = tmp_path / "agent"
    (agent / "scripts").mkdir(parents=True)
    (agent / "scripts" / "start_app.py").write_text("")
    assert vt.chatbot_ui_dir("agent-langgraph", agent) == "e2e-chatbot-app-next"
    assert vt.chatbot_ui_dir("agent-langchain-ts", tmp_path / "ts") == "ui"
    assert vt.chatbot_ui_dir("streamlit-hello-world-app", tmp_path / "other") is None


def test_prepare_source_bundles_chatbot_ui(tmp_path):
    import validate_templates as vt

    src = vt.prepare_source("agent-langchain-ts", tmp_path, bundle_chatbot_ui=True)
    assert (src / "ui" / "package.json").exists()
    assert not (src / "e2e-chatbot-app-next").exists()
    # agent-langchain-ts gitignores /ui; the copy must not, or sync skips it
    assert "/ui" not in (src / ".gitignore").read_text().splitlines()
    plain = vt.prepare_source("agent-langgraph", tmp_path / "plain")
    assert not (plain / "e2e-chatbot-app-next").exists()

def test_apply_replacements_rewrites_text_but_not_lockfiles(tmp_path):
    import validate_templates as vt

    (tmp_path / "config" / "queries").mkdir(parents=True)
    q = tmp_path / "config" / "queries" / "q.sql"
    q.write_text("SELECT 1 FROM REPLACE_ME.gold.t")
    lock = tmp_path / "package-lock.json"
    lock.write_text("REPLACE_ME.gold.")
    (tmp_path / "logo.png").write_bytes(b"\x89PNG\xff\xfe")
    n = vt.apply_replacements(tmp_path, (("REPLACE_ME.gold.", "main.s."),))
    assert n == 1
    assert q.read_text() == "SELECT 1 FROM main.s.t"
    assert lock.read_text() == "REPLACE_ME.gold."


def test_config_parses_replace_mapping(tmp_path):
    cfg_path = tmp_path / "c.yaml"
    cfg_path.write_text(
        "profile: p\nshared_app_name: a\nworkspace_source_root: /x\n"
        "templates:\n  t: { verify: spa, replace: { 'A.': 'B.' } }\n"
    )
    cfg = load_validation_config(cfg_path, resolve_workspace_root=False)
    assert cfg.templates[0].replace == (("A.", "B."),)
