#!/usr/bin/env python3
"""Mirror app-templates skills into a databricks-agent-skills checkout.

app-templates is the source of truth. This script renders the skills under
``.claude/skills/`` into the *flat*, marketplace-compatible layout that
databricks-agent-skills expects:

    databricks-agent-skills/skills/app-templates-<name>/

Why flat (not nested)? Claude Code discovers plugin skills only one level deep
under the plugin's ``skills/`` root, so a grouping dir like
``skills/app-templates/<name>/`` would be invisible. The ``app-templates-``
prefix namespaces the group while keeping every skill exactly one level deep.
See SKILLS_MIGRATION_PLAN.md for the full rationale.

What it does per skill:
  1. Copies the whole skill dir (SKILL.md + references/ + examples/ + ...).
  2. Renders template placeholders ({{BUNDLE_NAME}}, {{LAKEBASE_*}}) to generic
     values so the copy reads as a standalone skill.
  3. Rewrites the SKILL.md frontmatter ``name:`` to the prefixed dir name.
  4. Rewrites emphasized cross-skill references (``**deploy** skill``) to the
     prefixed name when they point at a sibling source skill.
  5. Writes a ``.synced-from`` provenance marker.

After writing, it runs the downstream ``scripts/skills.py generate`` so
``manifest.json`` + ``agents/openai.yaml`` + icon assets are produced in the
same change, then asserts no placeholder survived.

Usage:
    python3 .scripts/sync-skills-to-agent-skills.py --target /path/to/databricks-agent-skills
    python3 .scripts/sync-skills-to-agent-skills.py --target ... --no-generate   # skip downstream generate
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
SOURCE = REPO_ROOT / ".claude" / "skills"

PREFIX = "app-templates-"

# Generic default for the DAB bundle/resource key. Real templates substitute a
# per-template value at sync-to-template time; the standalone marketplace copy
# uses a neutral placeholder.
DEFAULT_BUNDLE_NAME = "my_agent"

# Lakebase blocks only appear in the quickstart skill. The template sync injects
# them only for memory templates; for the standalone marketplace copy we expand
# them in full (the most informative variant) so memory setup is documented.
LAKEBASE_OPTIONS = (
    "- `--lakebase-provisioned-name NAME`: Provisioned Lakebase instance name (memory templates)\n"
    "- `--lakebase-autoscaling-endpoint NAME`: Autoscaling Lakebase endpoint — short name or full resource path `projects/<p>/branches/<b>/endpoints/<e>` (memory templates)\n"
    "- `--lakebase-create-new NAME`: Provision a new Lakebase autoscaling project + branch with this name (memory templates)\n"
)
LAKEBASE_EXAMPLES = (
    "\n"
    "# Memory template with provisioned Lakebase\n"
    "uv run quickstart --lakebase-provisioned-name my-instance\n"
    "\n"
    "# Memory template with autoscaling Lakebase\n"
    "uv run quickstart --lakebase-autoscaling-endpoint projects/my-project/branches/production/endpoints/primary\n"
    "\n"
    "# Memory template — create a new Lakebase autoscaling project\n"
    "uv run quickstart --lakebase-create-new my-new-project\n"
)
LAKEBASE_CONFIGURES_ENV = (
    "- `LAKEBASE_INSTANCE_NAME` - Provisioned Lakebase instance name (if `--lakebase-provisioned-name` provided)\n"
    "- `LAKEBASE_AUTOSCALING_ENDPOINT` - Autoscaling Lakebase endpoint (if `--lakebase-autoscaling-endpoint` provided)\n"
    "- `PGHOST`, `PGUSER`, `PGDATABASE` - Postgres connection details (auto-resolved from the instance or endpoint)\n"
)
LAKEBASE_CONFIGURES_YML = (
    "\n"
    "Updates `databricks.yml` (if Lakebase flags provided):\n"
    "- Keeps only the env vars relevant to the selected Lakebase type (provisioned or autoscaling)\n"
    "- Rewrites the `postgres` or `database` resource block with concrete branch/database/instance values fetched from the workspace\n"
)

SUBSTITUTIONS = {
    "{{BUNDLE_NAME}}": DEFAULT_BUNDLE_NAME,
    "{{LAKEBASE_OPTIONS}}": LAKEBASE_OPTIONS,
    "{{LAKEBASE_EXAMPLES}}": LAKEBASE_EXAMPLES,
    "{{LAKEBASE_CONFIGURES_ENV}}": LAKEBASE_CONFIGURES_ENV,
    "{{LAKEBASE_CONFIGURES_YML}}": LAKEBASE_CONFIGURES_YML,
}

TEXT_SUFFIXES = {".md", ".markdown", ".txt", ".yaml", ".yml"}


def source_skill_names() -> list[str]:
    """All skill dir names under .claude/skills/ (each contains a SKILL.md)."""
    return sorted(
        d.name
        for d in SOURCE.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists()
    )


def render_text(text: str, sibling_names: list[str]) -> str:
    """Apply placeholder substitutions + cross-skill reference rewriting."""
    for placeholder, value in SUBSTITUTIONS.items():
        text = text.replace(placeholder, value)

    # Rewrite emphasized/backticked references to a sibling source skill, e.g.
    # ``**deploy** skill`` / `` `deploy` skill `` -> ``**app-templates-deploy** skill``.
    # Keyed on real source names, so template-sync artifact names like
    # ``add-tools`` / ``modify-agent`` / ``agent-memory`` (which are NOT source
    # dir names) are deliberately left as descriptive prose.
    for name in sibling_names:
        text = re.sub(
            r"(\*\*|`)" + re.escape(name) + r"(\*\*|`)(\s+skill)",
            lambda m: f"{m.group(1)}{PREFIX}{name}{m.group(2)}{m.group(3)}",
            text,
        )
    return text


def rewrite_frontmatter_name(text: str, new_name: str) -> str:
    """Rewrite the first ``name:`` line inside the SKILL.md frontmatter."""
    if not text.startswith("---"):
        return text
    end = text.find("---", 3)
    if end == -1:
        return text
    head, body = text[:end], text[end:]
    head, n = re.subn(
        r'(?m)^name:\s*["\']?[^"\'\n]+["\']?\s*$',
        f"name: {new_name}",
        head,
        count=1,
    )
    return head + body if n else text


def copy_skill(src: Path, dest: Path, new_name: str, sibling_names: list[str]) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for item in sorted(src.rglob("*")):
        rel = item.relative_to(src)
        target = dest / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        if item.suffix.lower() in TEXT_SUFFIXES:
            text = item.read_text()
            text = render_text(text, sibling_names)
            if item.name == "SKILL.md" and rel == Path("SKILL.md"):
                text = rewrite_frontmatter_name(text, new_name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)


def clean_existing(skills_root: Path) -> int:
    """Remove previously-synced app-templates-* dirs so deletions propagate."""
    removed = 0
    if not skills_root.exists():
        return removed
    for d in skills_root.iterdir():
        if d.is_dir() and d.name.startswith(PREFIX):
            shutil.rmtree(d)
            removed += 1
    return removed


def assert_no_placeholders(skills_root: Path) -> None:
    leftovers = []
    for d in skills_root.iterdir():
        if not (d.is_dir() and d.name.startswith(PREFIX)):
            continue
        for f in d.rglob("*"):
            if f.is_file() and f.suffix.lower() in TEXT_SUFFIXES:
                if "{{" in f.read_text():
                    leftovers.append(str(f.relative_to(skills_root)))
    if leftovers:
        raise SystemExit(
            "ERROR: unrendered placeholders remain in:\n  "
            + "\n  ".join(leftovers)
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        required=True,
        type=Path,
        help="Path to a databricks-agent-skills checkout.",
    )
    parser.add_argument(
        "--no-generate",
        action="store_true",
        help="Skip running the downstream scripts/skills.py generate + validate.",
    )
    args = parser.parse_args()

    target = args.target.resolve()
    skills_root = target / "skills"
    downstream_script = target / "scripts" / "skills.py"
    if not skills_root.is_dir() or not downstream_script.is_file():
        raise SystemExit(
            f"ERROR: {target} does not look like a databricks-agent-skills checkout "
            "(missing skills/ or scripts/skills.py)."
        )

    names = source_skill_names()
    if not names:
        raise SystemExit(f"ERROR: no source skills found under {SOURCE}")

    source_commit = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip() or "unknown"

    removed = clean_existing(skills_root)
    print(f"Removed {removed} stale '{PREFIX}*' skill dir(s).")

    for name in names:
        new_name = PREFIX + name
        dest = skills_root / new_name
        copy_skill(SOURCE / name, dest, new_name, names)
        (dest / ".synced-from").write_text(
            "Generated by app-templates/.scripts/sync-skills-to-agent-skills.py\n"
            "Source of truth: github.com/databricks/app-templates\n"
            f"Source skill: .claude/skills/{name}\n"
            f"Source commit: {source_commit}\n"
            "Do not hand-edit — changes go to app-templates.\n"
        )
        print(f"  synced {name} -> skills/{new_name}")

    assert_no_placeholders(skills_root)
    print(f"Synced {len(names)} skill(s); no placeholders remain.")

    if args.no_generate:
        print("Skipping downstream generate (--no-generate).")
        return

    print("Running downstream scripts/skills.py generate ...")
    subprocess.run([sys.executable, str(downstream_script), "generate"], cwd=target, check=True)
    print("Running downstream scripts/skills.py validate ...")
    subprocess.run([sys.executable, str(downstream_script), "validate"], cwd=target, check=True)


if __name__ == "__main__":
    main()
