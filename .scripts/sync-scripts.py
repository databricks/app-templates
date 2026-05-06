#!/usr/bin/env python3
"""Sync shared scripts and CI workflows to all agent templates.

The source of truth is .scripts/source/. This script copies:

- Shared Python scripts (verbatim copy) into each template's `scripts/`
  or `agent_server/` directory, respecting per-template `exclude_scripts`.
- GitHub Actions workflows (with `{{BUNDLE_NAME}}` substitution) into
  each template's `.github/workflows/` directory, gated on the
  `has_actions` field in templates.py.

Usage:
    python .scripts/sync-scripts.py
"""

import shutil
from pathlib import Path

from templates import TEMPLATES

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
SOURCE_DIR = SCRIPT_DIR / "source"

# (source_filename, destination_subdir)
SCRIPTS_TO_SYNC = [
    ("quickstart.py", "scripts"),
    ("start_app.py", "scripts"),
    ("evaluate_agent.py", "agent_server"),
    ("grant_lakebase_permissions.py", "scripts"),
    ("preflight.py", "scripts"),
]

# (source_filename, subdir_under_source_and_template)
WORKFLOWS_TO_SYNC = [
    ("deploy.yml", ".github/workflows"),
]


def sync_scripts(template: str, config: dict) -> list[str]:
    """Copy shared Python scripts into the template. Returns list of synced names."""
    exclude = config.get("exclude_scripts", [])
    scripts = [(s, d) for s, d in SCRIPTS_TO_SYNC if s not in exclude]
    synced: list[str] = []
    for script, dest_subdir in scripts:
        dest_dir = REPO_ROOT / template / dest_subdir
        if not dest_dir.exists():
            print(f"  Warning: {dest_dir} does not exist, skipping {script}")
            continue
        shutil.copy2(SOURCE_DIR / script, dest_dir / script)
        synced.append(script)
    return synced


def sync_workflows(template: str, config: dict) -> list[str]:
    """Copy CI workflows into the template (with {{BUNDLE_NAME}} substitution).

    Gated on `has_actions: True` in templates.py. Templates that opt in get
    `.github/workflows/` created if missing. Returns list of synced names.
    """
    if not config.get("has_actions"):
        return []
    bundle_name = config["bundle_name"]
    if not isinstance(bundle_name, str):
        # Templates with multi-SDK bundle_name lists don't have a single key
        # to substitute into a workflow. Skip until we have a per-target
        # variant of the workflow if/when one of them opts in.
        print(f"  Warning: {template} has non-string bundle_name; skipping workflow sync")
        return []
    synced: list[str] = []
    for workflow, dest_subdir in WORKFLOWS_TO_SYNC:
        src = SOURCE_DIR / dest_subdir / workflow
        if not src.exists():
            print(f"Source workflow not found: {src}")
            raise SystemExit(1)
        dest_dir = REPO_ROOT / template / dest_subdir
        dest_dir.mkdir(parents=True, exist_ok=True)
        content = src.read_text().replace("{{BUNDLE_NAME}}", bundle_name)
        (dest_dir / workflow).write_text(content)
        synced.append(f"{dest_subdir}/{workflow}")
    return synced


def main():
    if not SOURCE_DIR.exists():
        print(f"Source directory not found: {SOURCE_DIR}")
        raise SystemExit(1)

    for script, _ in SCRIPTS_TO_SYNC:
        if not (SOURCE_DIR / script).exists():
            print(f"Source file not found: {SOURCE_DIR / script}")
            raise SystemExit(1)

    for template, config in TEMPLATES.items():
        scripts_synced = sync_scripts(template, config)
        workflows_synced = sync_workflows(template, config)
        all_synced = scripts_synced + workflows_synced
        if all_synced:
            print(f"Syncing {template}... ({', '.join(all_synced)})")
        else:
            print(f"Skipping {template} (nothing to sync)")

    print("Done!")


if __name__ == "__main__":
    main()
