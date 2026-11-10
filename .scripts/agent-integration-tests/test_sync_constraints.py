"""Unit tests for the constraint-dependencies rewriter in .scripts/sync-scripts.py.

The sync rewrites every Python template's pyproject.toml. The replace path only
runs on a re-sync, so sync-check's git diff on a first sync would not catch a bug
there; these cover all three branches directly.
"""

import importlib.util
import sys
import tomllib
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]


def _load_sync_scripts():
    sys.path.insert(0, str(SCRIPTS_DIR))  # sync-scripts.py imports `templates`
    try:
        spec = importlib.util.spec_from_file_location("sync_scripts", SCRIPTS_DIR / "sync-scripts.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(SCRIPTS_DIR))


sync = _load_sync_scripts()


def _uv(text: str) -> dict:
    return tomllib.loads(text)["tool"]["uv"]


def test_appends_tool_uv_table_when_missing():
    text = '[project]\nname = "x"\n\n[tool.ruff]\nline-length = 88\n'
    out = sync._with_uv_constraints(text, ["certifi>=2026.10.18"])
    assert _uv(out)["constraint-dependencies"] == ["certifi>=2026.10.18"]
    assert tomllib.loads(out)["tool"]["ruff"]["line-length"] == 88
    assert out.count(sync.CONSTRAINTS_BEGIN) == 1


def test_inserts_under_existing_tool_uv_and_keeps_its_keys():
    text = '[project]\nname = "x"\n\n[tool.uv]\nexclude-newer = "7 days"\ndefault-groups = ["dev"]\n'
    out = sync._with_uv_constraints(text, ["certifi>=2026.10.18"])
    uv = _uv(out)
    assert uv["constraint-dependencies"] == ["certifi>=2026.10.18"]
    assert uv["exclude-newer"] == "7 days"
    assert uv["default-groups"] == ["dev"]
    assert out.count("[tool.uv]") == 1


def test_resync_replaces_the_block_instead_of_duplicating_it():
    text = '[tool.uv]\nexclude-newer = "7 days"\n'
    first = sync._with_uv_constraints(text, ["certifi>=2026.10.18"])
    second = sync._with_uv_constraints(first, ["certifi>=2026.10.18", "urllib3>=2.5.0"])
    assert second.count(sync.CONSTRAINTS_BEGIN) == 1
    assert second.count(sync.CONSTRAINTS_END) == 1
    assert _uv(second)["constraint-dependencies"] == ["certifi>=2026.10.18", "urllib3>=2.5.0"]
    assert _uv(second)["exclude-newer"] == "7 days"


def test_resync_with_same_specs_is_a_no_op():
    text = '[tool.uv]\nexclude-newer = "7 days"\n'
    once = sync._with_uv_constraints(text, ["certifi>=2026.10.18"])
    assert sync._with_uv_constraints(once, ["certifi>=2026.10.18"]) == once


def test_source_constraints_parse_to_specifiers():
    specs = sync._constraint_specs()
    assert specs, "constraints.txt has no specifiers"
    assert all(not s.startswith("#") and " " not in s for s in specs)
    assert any(s.startswith("certifi>=") for s in specs)
