#!/usr/bin/env python3
"""Sync quickstart.py and start_app.py to all agent templates.

The source of truth is .scripts/source/. This script copies scripts
from there to every template's scripts/ directory.

Usage:
    python .scripts/sync-scripts.py
"""

import shutil
from pathlib import Path

from templates import TEMPLATES

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
SOURCE_DIR = SCRIPT_DIR / "source"

SCRIPTS_TO_SYNC = ["quickstart.py", "start_app.py"]


def main():
    if not SOURCE_DIR.exists():
        print(f"Source directory not found: {SOURCE_DIR}")
        raise SystemExit(1)

    for script in SCRIPTS_TO_SYNC:
        if not (SOURCE_DIR / script).exists():
            print(f"Source file not found: {SOURCE_DIR / script}")
            raise SystemExit(1)

    for template, config in TEMPLATES.items():
        dest_dir = REPO_ROOT / template / "scripts"
        if not dest_dir.exists():
            print(f"Skipping {template} (scripts/ directory not found)")
            continue

        exclude = config.get("exclude_scripts", [])
        scripts = [s for s in SCRIPTS_TO_SYNC if s not in exclude]
        if not scripts:
            print(f"Skipping {template} (all scripts excluded)")
            continue

        print(f"Syncing {template}...")
        for script in scripts:
            shutil.copy2(SOURCE_DIR / script, dest_dir / script)

    print("Done!")


if __name__ == "__main__":
    main()
