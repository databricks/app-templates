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
import re
from pathlib import Path

from templates import MLFLOW_DEPENDENCY, MLFLOW_UC_DEFAULTS, TEMPLATES

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


def sync_mlflow_uc_configuration(template: str, config: dict) -> list[str]:
    """Keep Python agent dependencies and deployed UC tracing config aligned."""
    template_dir = REPO_ROOT / template
    changed: list[str] = []

    pyproject = template_dir / "pyproject.toml"
    pyproject_content = pyproject.read_text()
    pinned = re.sub(
        r'"mlflow(?:\[databricks\])?[^\"]*"',
        f'"{MLFLOW_DEPENDENCY}"',
        pyproject_content,
        count=1,
    )
    if pinned == pyproject_content and MLFLOW_DEPENDENCY not in pyproject_content:
        raise RuntimeError(f"Could not find the MLflow dependency in {pyproject}")
    if pinned != pyproject_content:
        pyproject.write_text(pinned)
        changed.append("pyproject.toml")

    bundle_path = template_dir / "databricks.yml"
    bundle = bundle_path.read_text()
    if "MLFLOW_TRACING_SQL_WAREHOUSE_ID" not in bundle:
        experiment_env = (
            "          - name: MLFLOW_EXPERIMENT_ID\n"
            "            value_from: \"experiment\"\n"
        )
        trace_env = (
            "          - name: MLFLOW_TRACING_SQL_WAREHOUSE_ID\n"
            "            value_from: \"mlflow-tracing-warehouse\"\n"
            f"          - name: MLFLOW_UC_CATALOG\n            value: \"{MLFLOW_UC_DEFAULTS['MLFLOW_UC_CATALOG']}\"\n"
            f"          - name: MLFLOW_UC_SCHEMA\n            value: \"{MLFLOW_UC_DEFAULTS['MLFLOW_UC_SCHEMA']}\"\n"
            f"          - name: MLFLOW_UC_TABLE_PREFIX\n            value: \"{MLFLOW_UC_DEFAULTS['MLFLOW_UC_TABLE_PREFIX']}\"\n"
            f"          - name: MLFLOW_OTEL_SPANS_TABLE\n            value: \"{MLFLOW_UC_DEFAULTS['MLFLOW_OTEL_SPANS_TABLE']}\"\n"
        )
        if experiment_env not in bundle:
            raise RuntimeError(f"Could not find the MLflow experiment env binding in {bundle_path}")
        bundle = bundle.replace(experiment_env, experiment_env + trace_env, 1)

        experiment_resource = re.search(
            r"(?P<block>        - name: ['\"]experiment['\"]\n"
            r"          experiment:\n"
            r"            experiment_id: .*\n"
            r"            permission: ['\"]CAN_MANAGE['\"]\n)",
            bundle,
        )
        if not experiment_resource:
            raise RuntimeError(f"Could not find the MLflow experiment resource in {bundle_path}")
        warehouse_resource = (
            "        - name: 'mlflow-tracing-warehouse'\n"
            "          sql_warehouse:\n"
            "            id: \"<your-mlflow-tracing-warehouse-id>\"\n"
            "            permission: 'CAN_USE'\n"
        )
        bundle = (
            bundle[: experiment_resource.end()]
            + warehouse_resource
            + bundle[experiment_resource.end() :]
        )
        bundle_path.write_text(bundle)
        changed.append("databricks.yml")

    if config.get("has_app_yaml"):
        app_path = template_dir / "app.yaml"
        app = app_path.read_text()
        if "MLFLOW_TRACING_SQL_WAREHOUSE_ID" not in app:
            experiment_env = (
                "  - name: MLFLOW_EXPERIMENT_ID\n"
                "    valueFrom: \"experiment\"\n"
            )
            trace_env = (
                "  - name: MLFLOW_TRACING_SQL_WAREHOUSE_ID\n"
                "    valueFrom: \"mlflow-tracing-warehouse\"\n"
                f"  - name: MLFLOW_UC_CATALOG\n    value: \"{MLFLOW_UC_DEFAULTS['MLFLOW_UC_CATALOG']}\"\n"
                f"  - name: MLFLOW_UC_SCHEMA\n    value: \"{MLFLOW_UC_DEFAULTS['MLFLOW_UC_SCHEMA']}\"\n"
                f"  - name: MLFLOW_UC_TABLE_PREFIX\n    value: \"{MLFLOW_UC_DEFAULTS['MLFLOW_UC_TABLE_PREFIX']}\"\n"
                f"  - name: MLFLOW_OTEL_SPANS_TABLE\n    value: \"{MLFLOW_UC_DEFAULTS['MLFLOW_OTEL_SPANS_TABLE']}\"\n"
            )
            if experiment_env not in app:
                raise RuntimeError(f"Could not find the MLflow experiment env binding in {app_path}")
            app_path.write_text(app.replace(experiment_env, experiment_env + trace_env, 1))
            changed.append("app.yaml")

    return changed


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
        config_synced = sync_mlflow_uc_configuration(template, config)
        all_synced = scripts_synced + workflows_synced + config_synced
        if all_synced:
            print(f"Syncing {template}... ({', '.join(all_synced)})")
        else:
            print(f"Skipping {template} (nothing to sync)")

    print("Done!")


if __name__ == "__main__":
    main()
