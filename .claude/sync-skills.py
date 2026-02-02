#!/usr/bin/env python3
"""Sync skills from .claude/skills/ to all agent templates.

This script copies skills from the source of truth (.claude/skills/) to each
template directory. Each template gets a complete copy of its skills (no symlinks)
so that `databricks workspace export-dir` works correctly.

Usage:
    python .claude/sync-skills.py
"""

import os
import shutil
from pathlib import Path

# Get repo root (parent of .claude directory where this script lives)
SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent

TEMPLATES = {
    "agent-langgraph": {
        "sdk": "langgraph",
        "bundle_name": "agent_langgraph",
    },
    "agent-langgraph-short-term-memory": {
        "sdk": "langgraph",
        "bundle_name": "agent_langgraph_short_term_memory",
    },
    "agent-langgraph-long-term-memory": {
        "sdk": "langgraph",
        "bundle_name": "agent_langgraph_long_term_memory",
    },
    "agent-openai-agents-sdk": {
        "sdk": "openai",
        "bundle_name": "agent_openai_agents_sdk",
    },
    "agent-non-conversational": {
        "sdk": "langgraph",
        "bundle_name": "agent_non_conversational",
    },
}

SOURCE = SCRIPT_DIR / "skills"


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
    for skill in ["quickstart", "run-locally", "discover-tools"]:
        copy_skill(SOURCE / skill, dest / skill)

    # Deploy skill (with substitution)
    copy_skill(SOURCE / "deploy", dest / "deploy", subs)

    # SDK-specific skills (renamed on copy)
    copy_skill(SOURCE / f"add-tools-{sdk}", dest / "add-tools")
    copy_skill(SOURCE / f"modify-{sdk}-agent", dest / "modify-agent")

    # Memory skills (all LangGraph templates - enables adding memory to any agent)
    # SDK-specific memory skills are renamed on copy (e.g., agent-langgraph-memory -> agent-memory)
    if sdk == "langgraph":
        copy_skill(SOURCE / "lakebase-setup", dest / "lakebase-setup")
        copy_skill(SOURCE / "agent-langgraph-memory", dest / "agent-memory")


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
