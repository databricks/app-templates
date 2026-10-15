---
name: sync-check
description: "Verify every per-template duplicated/synced file is byte-identical to its source of truth. Use when reviewing a PR that touches a template or a shared source file (.scripts/source/, .claude/skills/), or before pushing such a change, to catch drift — a copy edited directly, or a sync not re-run. Repo-dev tool — NOT synced into templates."
---

# Sync check — enforce that synced copies match their source

Templates in this repo must be **self-contained**: Databricks Apps deploys each
template as its own directory (`databricks workspace export-dir`), so a template
can't import shared code from outside its folder, and symlinks don't survive the
export. Shared files are therefore **copied into every template** by the sync
scripts, with the single source of truth in `.scripts/source/` and `.claude/skills/`:

- `.scripts/sync-scripts.py` → the shared Python scripts listed in `SCRIPTS_TO_SYNC`
  (`quickstart.py`, `start_app.py`, `evaluate_agent.py`, `preflight.py`, …) plus
  `.github/workflows/deploy.yml` (with `{{BUNDLE_NAME}}` substitution). See the
  script itself for the authoritative, current list of what it copies.
- `.scripts/sync-skills.py` → each template's `.claude/skills/`.
- `.scripts/sync-scripts.py` also **generates** the node crash-test fixture's
  plain-JS diagnostics
  (`.scripts/agent-integration-tests/crash-examples/node_crash_app/diagnostics.mjs`)
  from `.scripts/source/diagnostics.ts` by stripping TS types. That fixture runs as
  raw `node index.mjs` (no TS build) and must be self-contained for deploy, so it
  can't import the shared `.ts` — generating it keeps its plain-JS twin from drifting.

The risk this guards is **drift**: someone edits a copy directly, or edits the
source but forgets to re-run the sync, so the per-template copies silently diverge.

## Run it

From the repo root:

```bash
python .scripts/sync-scripts.py && python .scripts/sync-skills.py && git diff --exit-code
```

- **Exit 0, no diff** → every synced copy matches its source. ✅
- **Non-zero exit / a diff is printed** → drift; the diff names exactly which
  copies are stale.

The sync scripts are Python-stdlib-only (no venv needed) and safe to re-run — they
only rewrite the copies from source. `sync-scripts.py` additionally shells out to
`node` (present throughout this Node-heavy repo) to regenerate the crash fixture's
diagnostics twin; it fails loudly if `node` is missing rather than skipping the
check. They create `.scripts/__pycache__/`, which is gitignored and does not affect
the check.

## Fix drift

Never hand-edit a synced copy. Edit the **source** — `.scripts/source/<file>` or
`.claude/skills/<skill>/` — then re-run the sync and commit the regenerated copies:

```bash
python .scripts/sync-scripts.py
python .scripts/sync-skills.py
git add -A && git commit -m "chore: re-sync <file> from source"
```

## CI

The same check runs in CI via `.github/workflows/sync-check.yml` (it re-runs both
sync scripts and fails on any diff). **Until GitHub Actions is enabled on this repo,
run this check locally during code review** of any template change or any edit to a
shared source file.
