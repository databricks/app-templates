"""Tests for start_app.py's chat UI clone (#175): it checks out CHAT_UI_REF, not whatever is on main.

Run from .scripts/agent-integration-tests:
    uv run pytest ../source/test_start_app.py -v
"""

import importlib.util
import subprocess
import sys
import types
from pathlib import Path

import pytest

SOURCE = Path(__file__).parent / "start_app.py"


def load_start_app():
    if "dotenv" not in sys.modules:
        try:
            import dotenv  # noqa: F401
        except ImportError:  # the clone logic doesn't use it
            sys.modules["dotenv"] = types.SimpleNamespace(load_dotenv=lambda *a, **k: None)
    spec = importlib.util.spec_from_file_location("start_app_under_test", SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def upstream(tmp_path):
    """A local repo standing in for databricks/app-templates, with two versions of the chat UI."""
    repo = tmp_path / "upstream"
    (repo / "e2e-chatbot-app-next").mkdir(parents=True)
    (repo / "other-template").mkdir()
    git("init", "-q", "-b", "main", cwd=repo)
    git("config", "user.email", "test@example.com", cwd=repo)
    git("config", "user.name", "Test", cwd=repo)
    (repo / "other-template" / "README.md").write_text("not the chat UI\n")
    (repo / "e2e-chatbot-app-next" / "VERSION").write_text("v1\n")
    git("add", "-A", cwd=repo)
    git("commit", "-q", "-m", "v1", cwd=repo)
    v1 = git("rev-parse", "HEAD", cwd=repo)
    (repo / "e2e-chatbot-app-next" / "VERSION").write_text("v2\n")
    git("commit", "-q", "-am", "v2", cwd=repo)
    return repo, v1


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    monkeypatch.chdir(app)
    monkeypatch.delenv("CHAT_UI_REF", raising=False)
    return app


def test_pinned_ref_is_checked_out_not_main(upstream, workdir, capsys):
    repo, v1 = upstream
    start_app = load_start_app()
    assert start_app.ProcessManager().clone_frontend_if_needed(urls=[str(repo)], ref=v1)
    assert (workdir / "e2e-chatbot-app-next" / "VERSION").read_text() == "v1\n"
    assert not (workdir / "other-template").exists()
    assert not (workdir / "temp-app-templates").exists()
    assert f"e2e-chatbot-app-next at {v1}" in capsys.readouterr().out


def test_chat_ui_ref_env_overrides_the_pin(upstream, workdir, monkeypatch):
    repo, _ = upstream
    monkeypatch.setenv("CHAT_UI_REF", "main")
    start_app = load_start_app()
    assert start_app.ProcessManager().clone_frontend_if_needed(urls=[str(repo)])
    assert (workdir / "e2e-chatbot-app-next" / "VERSION").read_text() == "v2\n"


def test_default_ref_is_the_module_pin(upstream, workdir, monkeypatch):
    repo, v1 = upstream
    start_app = load_start_app()
    monkeypatch.setattr(start_app, "CHAT_UI_REF", v1)
    # The default argument binds at import, so pass the patched pin through the env-free path.
    assert start_app.ProcessManager().clone_frontend_if_needed(urls=[str(repo)], ref=start_app.CHAT_UI_REF)
    assert (workdir / "e2e-chatbot-app-next" / "VERSION").read_text() == "v1\n"


def test_existing_local_directory_is_used_as_is(upstream, workdir, capsys):
    repo, v1 = upstream
    (workdir / "e2e-chatbot-app-next").mkdir()
    (workdir / "e2e-chatbot-app-next" / "VERSION").write_text("local\n")
    start_app = load_start_app()
    assert start_app.ProcessManager().clone_frontend_if_needed(urls=[str(repo)], ref=v1)
    assert (workdir / "e2e-chatbot-app-next" / "VERSION").read_text() == "local\n"
    assert "CHAT_UI_REF ignored" in capsys.readouterr().out


def test_unknown_ref_fails_cleanly(upstream, workdir, capsys):
    repo, _ = upstream
    start_app = load_start_app()
    assert not start_app.ProcessManager().clone_frontend_if_needed(urls=[str(repo)], ref="no-such-ref")
    assert not (workdir / "e2e-chatbot-app-next").exists()
    assert not (workdir / "temp-app-templates").exists()
    assert "Could not check out CHAT_UI_REF='no-such-ref'" in capsys.readouterr().out


def test_pin_is_a_full_commit_sha():
    assert len(load_start_app().CHAT_UI_REF) == 40
