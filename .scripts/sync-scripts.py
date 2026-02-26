#!/usr/bin/env python3
"""Sync shared scripts to all agent templates.

The source of truth is .scripts/source/. This script copies scripts
from there to every template, respecting per-template exclusions.

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
]


def main():
    if not SOURCE_DIR.exists():
        print(f"Source directory not found: {SOURCE_DIR}")
        raise SystemExit(1)

    for script, _ in SCRIPTS_TO_SYNC:
        if not (SOURCE_DIR / script).exists():
            print(f"Source file not found: {SOURCE_DIR / script}")
            raise SystemExit(1)

    for template, config in TEMPLATES.items():
        exclude = config.get("exclude_scripts", [])
        scripts = [(s, d) for s, d in SCRIPTS_TO_SYNC if s not in exclude]
        if not scripts:
            print(f"Skipping {template} (all scripts excluded)")
            continue

        synced = []
        for script, dest_subdir in scripts:
            dest_dir = REPO_ROOT / template / dest_subdir
            if not dest_dir.exists():
                continue
            shutil.copy2(SOURCE_DIR / script, dest_dir / script)
            synced.append(script)

        if synced:
            print(f"Syncing {template}... ({', '.join(synced)})")

    print("Done!")


if __name__ == "__main__":
    main()
