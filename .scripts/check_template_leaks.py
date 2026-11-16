"""Scan agent templates for accidentally committed workspace-specific values.

This is a PUBLIC repository. Config files must use placeholders, not real
workspace names, IDs, budget policies, or personal identifiers.

Usage:
    uv run python .scripts/check_template_leaks.py        # from repo root
    python .scripts/check_template_leaks.py                # also works

Exit code 0 = clean, 1 = leaks found.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_DIRS = sorted(REPO_ROOT.glob("agent-*/"))

# Files to scan inside each template directory
SCAN_GLOBS = ["databricks.yml", "app.yaml", ".env.example"]


def _compile(pattern):
    return re.compile(pattern)


# ── Line-level rules ────────────────────────────────────────────────────────
# (description, compiled_regex).  Applied to every non-comment line.

RULES = [
    # budget_policy_id should never appear in templates
    (
        "budget_policy_id should not be in templates",
        _compile(r"^\s*budget_policy_id\s*:"),
    ),
    # experiment_id must be empty
    (
        "experiment_id must be empty (not a real ID)",
        _compile(r"""experiment_id\s*:\s*['"]?(\d+)['"]?"""),
    ),
    # Lakebase instance name must be a placeholder
    (
        "Lakebase instance_name must be a placeholder, not a real name",
        _compile(
            r"""instance_name\s*:\s*['"]?(?!<your-)([a-zA-Z0-9][a-zA-Z0-9_-]+)['"]?"""
        ),
    ),
    # LAKEBASE_INSTANCE_NAME env var value must be a placeholder
    (
        "LAKEBASE_INSTANCE_NAME value must be a placeholder",
        _compile(
            r"""LAKEBASE_INSTANCE_NAME.*?(?:value|valueFrom)\s*:\s*['"]?(?!<your-)([a-zA-Z0-9][a-zA-Z0-9_-]+)['"]?"""
        ),
    ),
    # Hardcoded UUIDs (budget_policy_id, SP client IDs, etc.)
    (
        "Hardcoded UUID found (likely a workspace resource ID)",
        _compile(
            r"""['"]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})['"]"""
        ),
    ),
]

# ── Comment detection ────────────────────────────────────────────────────────
YAML_COMMENT_RE = re.compile(r"^\s*#")


def _is_comment(line):
    return bool(YAML_COMMENT_RE.match(line))


# ── App name validation ─────────────────────────────────────────────────────
# App names in databricks.yml should derive from the template directory name,
# optionally with ${bundle.target} prefix.  Flag names containing personal
# identifiers or that don't relate to the template at all.

APP_NAME_RE = re.compile(
    r"""^\s*name\s*:\s*['"](.+?)['"]""",
)

# The app name section is nested under resources.apps.<key>.name
# We detect it by looking for `name:` lines that appear after `apps:` context.
# Simpler approach: just flag app names that are suspicious.
ALLOWED_APP_NAME_PARTS = {
    "agent", "langgraph", "openai", "non", "conversational", "multiagent",
    "advanced", "migration", "model", "serving", "long", "running", "short",
    "term", "memory", "sdk", "agents", "from", "oai", "lra",
    "stm", "ltm",  # standard abbreviations for short/long-term-memory
    # DAB target variable
    "${bundle.target}",
}


def check_app_name(template_dir, path, lines):
    """Check that app names in databricks.yml don't contain personal identifiers."""
    violations = []
    rel = path.relative_to(REPO_ROOT)
    in_apps_section = False

    for line_num, line in enumerate(lines, 1):
        if _is_comment(line):
            continue
        # Track if we're in resources.apps section
        if re.match(r"^\s+apps:\s*$", line):
            in_apps_section = True
            continue
        if in_apps_section:
            match = APP_NAME_RE.match(line)
            if match:
                app_name = match.group(1)
                # Split on hyphens and check parts
                parts = app_name.replace("${bundle.target}", "").split("-")
                parts = [p for p in parts if p]  # drop empty
                unknown = [
                    p for p in parts
                    if p.lower() not in ALLOWED_APP_NAME_PARTS
                    and not re.match(r"^\$\{", p)  # allow DAB variables
                ]
                if unknown:
                    violations.append(
                        f"  {rel}:{line_num}: App name contains "
                        f"non-template words: {unknown}\n"
                        f"    → name: \"{app_name}\""
                    )
                in_apps_section = False
    return violations


# ── Env var value validation ─────────────────────────────────────────────────
# In app.yaml / databricks.yml, env vars are specified as multi-line blocks:
#   - name: LAKEBASE_INSTANCE_NAME
#     value: "bbqiu"             <-- this should be a placeholder
# We track `name:` lines and check the following `value:` line.

SENSITIVE_ENV_VARS = {"LAKEBASE_INSTANCE_NAME"}
ENV_NAME_RE = re.compile(r"""^\s*-?\s*name\s*:\s*['"]?(\w+)['"]?""")
ENV_VALUE_RE = re.compile(r"""^\s*value\s*:\s*['"]?(.+?)['"]?\s*$""")


def check_env_var_values(path, lines):
    """Flag env vars with hardcoded values that should be placeholders."""
    violations = []
    rel = path.relative_to(REPO_ROOT)
    pending_var = None

    for line_num, line in enumerate(lines, 1):
        if _is_comment(line):
            continue
        name_match = ENV_NAME_RE.match(line)
        if name_match:
            var_name = name_match.group(1)
            if var_name in SENSITIVE_ENV_VARS:
                pending_var = (var_name, line_num)
            else:
                pending_var = None
            continue
        if pending_var:
            val_match = ENV_VALUE_RE.match(line)
            if val_match:
                value = val_match.group(1)
                if value and not value.startswith("<"):
                    violations.append(
                        f"  {rel}:{line_num}: {pending_var[0]} env var has "
                        f"a hardcoded value (use a placeholder)\n"
                        f"    → value: \"{value}\""
                    )
            pending_var = None

    return violations


# ── File scanner ─────────────────────────────────────────────────────────────


def scan_file(template_dir, path):
    """Return a list of violation strings for the given file."""
    violations = []
    try:
        text = path.read_text()
        lines = text.splitlines()
    except Exception as e:
        return [f"  Could not read {path}: {e}"]

    rel = path.relative_to(REPO_ROOT)

    for line_num, line in enumerate(lines, 1):
        if _is_comment(line):
            continue
        for desc, pattern in RULES:
            match = pattern.search(line)
            if match:
                matched_text = match.group(0).strip()
                violations.append(
                    f"  {rel}:{line_num}: {desc}\n    → {matched_text}"
                )

    # App name check (databricks.yml only)
    if path.name == "databricks.yml":
        violations.extend(check_app_name(template_dir, path, lines))

    # Multi-line env var check (app.yaml / databricks.yml):
    # Catches `- name: LAKEBASE_INSTANCE_NAME` followed by `value: "bbqiu"`
    violations.extend(check_env_var_values(path, lines))

    return violations


def main():
    all_violations = []

    for template_dir in TEMPLATE_DIRS:
        for glob_pattern in SCAN_GLOBS:
            for path in template_dir.glob(glob_pattern):
                violations = scan_file(template_dir, path)
                all_violations.extend(violations)

    if all_violations:
        print(f"Found {len(all_violations)} leaked value(s) in templates:\n")
        for v in all_violations:
            print(v)
        print(
            "\nThese files are in a PUBLIC repository. Replace workspace-specific "
            "values with placeholders or empty strings."
        )
        return 1
    else:
        print("No leaked values found in templates.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
