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
import os
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / ".scripts"
SOURCE_DIR = SCRIPTS_DIR / "source"
_PRUNE_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".pytest_cache", "dist", "build", ".next"}


def _find_copies(filename: str) -> list[Path]:
    """Every file named `filename` in the repo (pruning vendored/build dirs)."""
    hits: list[Path] = []
    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in _PRUNE_DIRS]
        if filename in files:
            hits.append(Path(root) / filename)
    return hits


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


def test_diagnostics_copies_match_source():
    """Enforce no drift: every synced diagnostics copy is byte-identical to source.

    The module is deliberately copied into each template (Databricks Apps deploys
    each template as a self-contained directory, so it can't import from a shared
    location, and symlinks don't survive `workspace export-dir`). The source of
    truth is `.scripts/source/`; this guard fails if any copy diverges, so a manual
    edit to a copy (instead of editing the source + re-running sync-scripts.py) is
    caught instead of silently drifting across ~30 templates.
    """
    checks = [
        ("app_diagnostics.py", SOURCE_DIR / "app_diagnostics.py"),
        ("diagnostics.ts", SOURCE_DIR / "diagnostics.ts"),
    ]
    mismatches: list[str] = []
    counts: dict[str, int] = {}
    for filename, src_path in checks:
        source = src_path.read_text()
        copies = [p for p in _find_copies(filename) if p.resolve() != src_path.resolve()]
        counts[filename] = len(copies)
        for copy in copies:
            if copy.read_text() != source:
                mismatches.append(str(copy.relative_to(REPO_ROOT)))
    # Sanity: detection actually found the copies (so a passing test means something).
    assert counts["app_diagnostics.py"] > 0, "found no app_diagnostics.py copies — detection broken"
    assert counts["diagnostics.ts"] > 0, "found no diagnostics.ts copies — detection broken"
    assert not mismatches, (
        "synced diagnostics copies have DRIFTED from .scripts/source/ (edit the "
        "source, not the copy, then run `uv run python .scripts/sync-scripts.py`): "
        f"{sorted(mismatches)}"
    )
