#!/usr/bin/env python3
"""Sync skills from .claude/skills/ to all agent templates.

This script copies skills from the source of truth (.claude/skills/) to each
template directory. Each template gets a complete copy of its skills (no symlinks)
so that `databricks workspace export-dir` works correctly.

Usage:
    python .scripts/sync-skills.py
"""

import shutil
from pathlib import Path

from templates import TEMPLATES

# Get repo root (parent of .scripts directory where this script lives)
SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent

SOURCE = REPO_ROOT / ".claude" / "skills"


def copy_skill(src: Path, dest: Path, substitutions: dict = None):
    """Copy skill directory, applying substitutions to SKILL.md."""
    dest.mkdir(parents=True, exist_ok=True)

    for item in src.iterdir():
        if item.is_dir():
            shutil.copytree(item, dest / item.name, dirs_exist_ok=True)
        elif item.suffix == ".md" and substitutions:
            content = item.read_text()
            for placeholder, value in substitutions.items():
                content = content.replace(placeholder, value)
            (dest / item.name).write_text(content)
        else:
            shutil.copy2(item, dest / item.name)


def sync_template(template: str, config: dict):
    """Sync all skills to a single template."""
    dest = REPO_ROOT / template / ".claude" / "skills"
    sdk = config["sdk"]
    subs = {"{{BUNDLE_NAME}}": config["bundle_name"]}

    # Clear existing skills
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    # Shared skills (no substitution needed)
    for skill in ["quickstart", "run-locally", "discover-tools", "migrate-from-model-serving"]:
        copy_skill(SOURCE / skill, dest / skill)

    # Deploy skill (with substitution)
    copy_skill(SOURCE / "deploy", dest / "deploy", subs)

    # SDK-specific skills (with substitution for bundle name references)
    if isinstance(sdk, list):
        # Multiple SDKs: copy skills for each, keeping SDK suffix in name
        for s in sdk:
            copy_skill(SOURCE / f"add-tools-{s}", dest / f"add-tools-{s}", subs)
            copy_skill(SOURCE / f"modify-{s}-agent", dest / f"modify-{s}-agent", subs)
        # Include LangGraph memory skills if langgraph is in the list
        if "langgraph" in sdk:
            copy_skill(SOURCE / "lakebase-setup", dest / "lakebase-setup")
            copy_skill(SOURCE / "agent-langgraph-memory", dest / "agent-memory")
    else:
        copy_skill(SOURCE / f"add-tools-{sdk}", dest / "add-tools", subs)
        copy_skill(SOURCE / f"modify-{sdk}-agent", dest / "modify-agent", subs)
        copy_skill(SOURCE / "lakebase-setup", dest / "lakebase-setup")
        if sdk == "langgraph":
            copy_skill(SOURCE / "agent-langgraph-memory", dest / "agent-memory")
        elif sdk == "openai":
            copy_skill(SOURCE / "agent-openai-memory", dest / "agent-memory")


def main():
    """Sync skills to all templates."""
    for template, config in TEMPLATES.items():
        template_path = REPO_ROOT / template
        if not template_path.exists():
            print(f"Skipping {template} (directory not found)")
            continue
        print(f"Syncing {template}...")
        sync_template(template, config)
    print("Done!")


if __name__ == "__main__":
    main()
