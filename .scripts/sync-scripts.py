#!/usr/bin/env python3
"""Sync quickstart.py and start_app.py to all agent templates.

The source of truth is agent-langgraph/scripts/. This script copies
quickstart.py and start_app.py from there to every other template.

Usage:
    python .scripts/sync-scripts.py
"""

import shutil
from pathlib import Path

from templates import TEMPLATES

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent

SOURCE_TEMPLATE = "agent-langgraph"
SCRIPTS_TO_SYNC = ["quickstart.py", "start_app.py"]


def main():
    source_dir = REPO_ROOT / SOURCE_TEMPLATE / "scripts"
    if not source_dir.exists():
        print(f"Source directory not found: {source_dir}")
        raise SystemExit(1)

    for script in SCRIPTS_TO_SYNC:
        source_file = source_dir / script
        if not source_file.exists():
            print(f"Source file not found: {source_file}")
            raise SystemExit(1)

    for template in TEMPLATES:
        if template == SOURCE_TEMPLATE:
            continue

        dest_dir = REPO_ROOT / template / "scripts"
        if not dest_dir.exists():
            print(f"Skipping {template} (scripts/ directory not found)")
            continue

        print(f"Syncing {template}...")
        for script in SCRIPTS_TO_SYNC:
            shutil.copy2(source_dir / script, dest_dir / script)

    print("Done!")


if __name__ == "__main__":
    main()
