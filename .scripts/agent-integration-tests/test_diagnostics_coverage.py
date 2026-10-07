"""Guard test: every non-OBO template must have diagnostics coverage.

Diagnostics (`app_diagnostics.py` / `diagnostics.ts`) are baked into templates via
explicit allowlists in `.scripts/sync-scripts.py` (`DIAGNOSTICS_PY_TARGETS`,
`DIAGNOSTICS_TS_TARGETS`) plus the agent registry in `.scripts/templates.py`
(agents receive the module through the normal script sync). None of that is
auto-discovered, so a newly added template silently gets NO diagnostics unless
someone wires it in.

This test fails loudly when that happens: it enumerates every template directory
and asserts each non-OBO one is covered. When it fails on a new template, either
wire it into the appropriate `DIAGNOSTICS_*_TARGETS` (and add the install call to
its entrypoint), or, if it is an OBO template (out of scope — same set the
deploy-validation harness skips), mark it `verify: obo` in `validation-config.yaml`.

The OBO exclusion set is derived from `validation-config.yaml` (the authoritative
`verify:` classification) rather than duplicated here, so the two can't drift.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / ".scripts"


def _obo_templates() -> set[str]:
    """OBO templates (verify: obo), from the authoritative validation config."""
    from validation_config import DEFAULT_CONFIG_PATH, load_validation_config

    cfg = load_validation_config(DEFAULT_CONFIG_PATH, resolve_workspace_root=False)
    return {t.name for t in cfg.templates if t.verify == "obo"}


def _load_agent_templates() -> set[str]:
    """Agent templates receive diagnostics via the script sync (templates.py)."""
    spec = importlib.util.spec_from_file_location(
        "templates_registry", SCRIPTS_DIR / "templates.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return set(mod.TEMPLATES.keys())


def _parse_diag_targets() -> set[str]:
    """Keys of DIAGNOSTICS_{PY,TS}_TARGETS, parsed textually (filename is hyphenated)."""
    text = (SCRIPTS_DIR / "sync-scripts.py").read_text()
    keys: set[str] = set()
    for var in ("DIAGNOSTICS_PY_TARGETS", "DIAGNOSTICS_TS_TARGETS"):
        m = re.search(var + r"\s*=\s*\{(.*?)\n\}", text, re.DOTALL)
        assert m, f"could not find {var} in sync-scripts.py"
        keys.update(re.findall(r'"([^"]+)"\s*:', m.group(1)))
    return keys


def _template_dirs() -> set[str]:
    """Top-level template directories (identified by app.yaml or databricks.yml)."""
    dirs = set()
    for child in REPO_ROOT.iterdir():
        if not child.is_dir() or child.name.startswith("."):
            continue
        if (child / "app.yaml").exists() or (child / "databricks.yml").exists():
            dirs.add(child.name)
    return dirs


def _covered() -> set[str]:
    return _load_agent_templates() | _parse_diag_targets()


def test_every_non_obo_template_has_diagnostics():
    dirs = _template_dirs()
    assert dirs, "found no template directories — detection logic is broken"
    required = dirs - _obo_templates()
    missing = sorted(required - _covered())
    assert not missing, (
        "These non-OBO templates have NO diagnostics coverage: "
        f"{missing}. Wire each into DIAGNOSTICS_PY_TARGETS or DIAGNOSTICS_TS_TARGETS "
        "in .scripts/sync-scripts.py (and add the install call to its entrypoint), "
        "then run `uv run python .scripts/sync-scripts.py`. If a listed template is "
        "actually OBO (out of scope), mark it `verify: obo` in validation-config.yaml."
    )


def test_no_stale_diagnostics_targets():
    """Every covered template name must be a real template directory."""
    stale = sorted(_covered() - _template_dirs())
    assert not stale, (
        f"Diagnostics targets reference non-existent template dirs: {stale}. "
        "A template was renamed/removed — update .scripts/sync-scripts.py / templates.py."
    )


def test_obo_exclusions_are_real_dirs():
    """Every OBO template in the config must be a real template directory."""
    stale = sorted(_obo_templates() - _template_dirs())
    assert not stale, (
        f"validation-config.yaml marks non-existent dirs as obo: {stale}. "
        "A template was renamed/removed — update validation-config.yaml."
    )
