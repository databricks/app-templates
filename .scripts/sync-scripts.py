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

import os
import shutil
import subprocess
from pathlib import Path

from templates import TEMPLATES

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
SOURCE_DIR = SCRIPT_DIR / "source"

# The node crash-test fixture runs as raw `node index.mjs` (no TS build step) and
# must be self-contained for deploy, so it can't import the shared TS source. We
# therefore GENERATE its plain-JS diagnostics twin from diagnostics.ts (stripping
# TS types) rather than hand-maintaining a second copy that could silently drift.
# The sync-check (`sync-scripts.py && git diff --exit-code`) enforces it stays in
# lockstep with the source.
NODE_CRASH_FIXTURE = (
    REPO_ROOT
    / ".scripts/agent-integration-tests/crash-examples/node_crash_app/diagnostics.mjs"
)
GENERATED_HEADER = (
    "// GENERATED from .scripts/source/diagnostics.ts by .scripts/sync-scripts.py —\n"
    "// DO NOT EDIT. Run `python .scripts/sync-scripts.py` to regenerate. Plain-JS\n"
    "// twin of the TS diagnostics module for the node_crash_app e2e crash fixture\n"
    "// (runs as raw `node index.mjs`, no TS build). Kept in lockstep by sync-check.\n\n"
)
# CJS one-liner: strip TS types, then reflow the whitespace the stripper leaves
# where `: Type` annotations were (rstrip each line; collapse 2+ spaces after the
# leading indent to one — safe because no string/comment in the source has 2+
# consecutive spaces, so only the stripper's gaps are touched).
_STRIP_TS_JS = r"""
const { stripTypeScriptTypes } = require('node:module');
const fs = require('fs');
let js = stripTypeScriptTypes(fs.readFileSync(process.argv[1], 'utf8'), { mode: 'strip' });
js = js.split('\n').map((l) => {
  const o = l.replace(/\s+$/, '');
  const m = o.match(/^(\s*)(.*)$/);
  return m[1] + m[2].replace(/ {2,}/g, ' ');
}).join('\n');
process.stdout.write(js);
"""

# (source_filename, destination_subdir)
SCRIPTS_TO_SYNC = [
    ("quickstart.py", "scripts"),
    ("app_diagnostics.py", "scripts"),
    ("start_app.py", "scripts"),
    ("evaluate_agent.py", "agent_server"),
    ("grant_lakebase_permissions.py", "scripts"),
    ("preflight.py", "scripts"),
]

# (source_filename, subdir_under_source_and_template)
WORKFLOWS_TO_SYNC = [
    ("deploy.yml", ".github/workflows"),
]

# Non-agent (non-OBO) templates: the diagnostics module is copied next to the app
# entrypoint so `import app_diagnostics` resolves. Value is the dir (relative to the
# template root) that holds the entrypoint. The one-line install_diagnostics() call
# in each entrypoint is a one-time manual edit; only the module is synced here, so
# the module can be fixed centrally in .scripts/source/app_diagnostics.py.
DIAGNOSTICS_PY_TARGETS = {
    "streamlit-hello-world-app": ".",
    "streamlit-chatbot-app": ".",
    "streamlit-data-app": ".",
    "streamlit-database-app": ".",
    "streamlit-postgres-app": ".",
    "e2e-chatbot-app": ".",
    "dash-hello-world-app": ".",
    "dash-chatbot-app": ".",
    "dash-data-app": ".",
    "dash-database-app": ".",
    "dash-postgres-app": ".",
    "flask-hello-world-app": ".",
    "flask-database-app": ".",
    "flask-postgres-app": ".",
    "gradio-hello-world-app": ".",
    "gradio-chatbot-app": ".",
    "gradio-data-app": ".",
    "shiny-hello-world-app": ".",
    "shiny-chatbot-app": ".",
    "shiny-data-app": ".",
    "mcp-server-hello-world": "server",
    "nodejs-fastapi-hello-world-app": "backend",
}


# Node templates: diagnostics.ts copied next to the entrypoint (the one-line
# `import './diagnostics'` in each entrypoint is a one-time manual edit).
DIAGNOSTICS_TS_TARGETS = {
    "e2e-chatbot-app-next": "server/src",
    "e2e-chatbot-model-service": "server/src",
    "rag-chat": "server",
    "agent-langchain-ts": "src",
}


def sync_diagnostics() -> list[str]:
    """Copy the diagnostics module next to each non-agent template's entrypoint."""
    synced: list[str] = []
    for template, dest_subdir in DIAGNOSTICS_PY_TARGETS.items():
        dest_dir = REPO_ROOT / template / dest_subdir
        if not dest_dir.exists():
            print(f"  Warning: {dest_dir} does not exist, skipping diagnostics for {template}")
            continue
        shutil.copy2(SOURCE_DIR / "app_diagnostics.py", dest_dir / "app_diagnostics.py")
        synced.append(f"{template}/{dest_subdir}/app_diagnostics.py")
    for template, dest_subdir in DIAGNOSTICS_TS_TARGETS.items():
        dest_dir = REPO_ROOT / template / dest_subdir
        if not dest_dir.exists():
            print(f"  Warning: {dest_dir} does not exist, skipping diagnostics for {template}")
            continue
        shutil.copy2(SOURCE_DIR / "diagnostics.ts", dest_dir / "diagnostics.ts")
        synced.append(f"{template}/{dest_subdir}/diagnostics.ts")
    return synced


def generate_node_crash_fixture() -> str:
    """Regenerate the node crash fixture's plain-JS diagnostics from diagnostics.ts.

    Fails loudly (never silently skips) if node is unavailable or the strip fails —
    a silent skip would let the fixture drift, which is exactly what we're guarding.
    """
    node = shutil.which("node")
    if node is None:
        raise SystemExit(
            "node not found on PATH — required to regenerate "
            f"{NODE_CRASH_FIXTURE.relative_to(REPO_ROOT)} from diagnostics.ts"
        )
    result = subprocess.run(
        [node, "-e", _STRIP_TS_JS, str(SOURCE_DIR / "diagnostics.ts")],
        capture_output=True,
        text=True,
        env={**os.environ, "NODE_NO_WARNINGS": "1"},
    )
    if result.returncode != 0:
        raise SystemExit(
            f"failed to strip TS types for {NODE_CRASH_FIXTURE.name}:\n{result.stderr}"
        )
    NODE_CRASH_FIXTURE.write_text(GENERATED_HEADER + result.stdout)
    return str(NODE_CRASH_FIXTURE.relative_to(REPO_ROOT))


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

    diag_synced = sync_diagnostics()
    if diag_synced:
        print(f"Synced diagnostics module to {len(diag_synced)} non-agent templates")

    crash_fixture = generate_node_crash_fixture()
    print(f"Generated node crash fixture: {crash_fixture}")

    print("Done!")


if __name__ == "__main__":
    main()
