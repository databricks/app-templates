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


LAKEBASE_OPTIONS = (
    "- `--lakebase-provisioned-name NAME`: Provisioned Lakebase instance name (memory templates)\n"
    "- `--lakebase-autoscaling-project PROJECT`: Autoscaling Lakebase project name (memory templates)\n"
    "- `--lakebase-autoscaling-branch BRANCH`: Autoscaling Lakebase branch name (memory templates)\n"
)

LAKEBASE_EXAMPLES = (
    "\n"
    "# Memory template with provisioned Lakebase\n"
    "uv run quickstart --lakebase-provisioned-name my-instance\n"
    "\n"
    "# Memory template with autoscaling Lakebase\n"
    "uv run quickstart --lakebase-autoscaling-project my-project --lakebase-autoscaling-branch production\n"
)

LAKEBASE_CONFIGURES_ENV = (
    "- `LAKEBASE_INSTANCE_NAME` - Provisioned Lakebase instance name (if `--lakebase-provisioned-name` provided)\n"
    "- `LAKEBASE_AUTOSCALING_PROJECT` and `LAKEBASE_AUTOSCALING_BRANCH` - Autoscaling project/branch (if `--lakebase-autoscaling-project/branch` provided)\n"
)

LAKEBASE_CONFIGURES_YML = (
    "\n"
    "Updates `databricks.yml` and `app.yaml` (if Lakebase flags provided):\n"
    "- Keeps only the env vars relevant to the selected Lakebase type (provisioned or autoscaling)\n"
    "- Removes the env vars for the other type\n"
)


def sync_template(template: str, config: dict):
    """Sync all skills to a single template."""
    dest = REPO_ROOT / template / ".claude" / "skills"
    sdk = config["sdk"]
    subs = {"{{BUNDLE_NAME}}": config["bundle_name"]}
    has_memory = config.get("has_memory", False)

    # Clear existing skills
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    # Quickstart skill (with lakebase options for memory templates)
    quickstart_subs = {
        "{{LAKEBASE_OPTIONS}}": LAKEBASE_OPTIONS if has_memory else "",
        "{{LAKEBASE_EXAMPLES}}": LAKEBASE_EXAMPLES if has_memory else "",
        "{{LAKEBASE_CONFIGURES_ENV}}": LAKEBASE_CONFIGURES_ENV if has_memory else "",
        "{{LAKEBASE_CONFIGURES_YML}}": LAKEBASE_CONFIGURES_YML if has_memory else "",
    }
    copy_skill(SOURCE / "quickstart", dest / "quickstart", quickstart_subs)

    # Shared skills (no substitution needed)
    for skill in ["run-locally", "discover-tools", "migrate-from-model-serving"]:
        copy_skill(SOURCE / skill, dest / skill)

    # Load-testing skill (excluded for non-conversational — incompatible input format)
    if not config.get("exclude_load_testing", False):
        copy_skill(SOURCE / "load-testing", dest / "load-testing")

    # Long-running server skill — skip for advanced templates (already have it) and non-conversational
    if not has_memory and template != "agent-non-conversational":
        copy_skill(SOURCE / "long-running-server", dest / "long-running-server")

    # Deploy skill (with substitution)
    copy_skill(SOURCE / "deploy", dest / "deploy", subs)

    # Add supervisor API to Open AI SDKs
    if sdk == "openai":
        copy_skill(SOURCE / "supervisor-api", dest / "supervisor-api")
        copy_skill(SOURCE / "supervisor-api-background-mode", dest / "supervisor-api-background-mode")

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
