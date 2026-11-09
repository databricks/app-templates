---
name: review-templates
description: "Composite pre-review gate for a template PR: (1) sync/duplication check, (2) semgrep static scan, (3) deploy e2e validation incl. crash cases. Use when reviewing or preparing a PR that changes templates or shared source (.scripts/source/, .claude/skills/). Repo-dev tool — NOT synced into templates. Distinct from Databricks' /review (Isaac Review)."
---

# review-templates — composite pre-review gate for template PRs

Runs the repo's static + e2e checks in one pass, for reviewing (or preparing) a PR
that touches templates or shared source. Repo-dev only — not synced into templates.

**This is not a substitute for Databricks' `/review` (Isaac Review), which does a
general code + documentation review.** This skill is the template-specific
validation gate: duplication → semgrep → deploy e2e.

Run the phases in order: 1 → 2 → 3. Phases 1-2 are fast local gates — clear them
before spending the ~1 hr deploy phase.

## Phase 1 — Duplication / sync drift (fast local gate)

Shared files are copied into each template (templates must be self-contained for
Databricks Apps' per-directory deploy). This fails if any copy drifted from source:

```bash
python .scripts/sync-scripts.py && python .scripts/sync-skills.py && git diff --exit-code
```

- Exit 0 = all copies match source. Non-zero = drift; the diff names the stale
  copies. Fix by editing the **source** (`.scripts/source/` or `.claude/skills/`)
  and re-running the sync — never hand-edit a copy. (See the `sync-check` skill.)

## Phase 2 — Static scan (semgrep)

Databricks Apps runs semgrep (community rules) against deployed app source on every
deploy, so the **authoritative** scan is server-side — Phase 3's deploy triggers it.
To pre-check locally, run semgrep via the Databricks pypi proxy (public pypi is
TLS-blocked in this environment):

```bash
# closest to the platform's ruleset (sends telemetry to semgrep.dev):
UV_INDEX_URL=https://pypi-proxy.cloud.databricks.com/simple UV_SYSTEM_CERTS=1 \
  uvx --from semgrep semgrep scan --config auto --error <changed-template-dirs>

# no-telemetry alternative (community pack; approximates, doesn't match exactly):
UV_INDEX_URL=https://pypi-proxy.cloud.databricks.com/simple UV_SYSTEM_CERTS=1 \
  uvx --from semgrep semgrep scan --config p/default --metrics off --error <changed-template-dirs>
```

- `--error` makes findings exit non-zero. Treat local results as **advisory** — the
  ruleset won't perfectly match the platform; the on-deploy scan (Phase 3) is
  authoritative.
- For a genuine false positive, suppress inline with `# nosemgrep: <rule-id>` + a
  short justification. Also confirm the `.claude/AGENTS.md` hygiene rules: exact npm
  versions, SHA-pinned GitHub Actions, `exclude-newer` in agent `pyproject.toml`.

## Phase 3 — Deploy e2e validation (incl. crash handling)

Use the `validate-templates` skill. Prereqs: a Databricks CLI profile
(`DATABRICKS_CONFIG_PROFILE`, default `dogfood`), the shared app `template-e2e-test`
with its resource bindings, and a fresh SSO storageState. The storageState expires
~daily and needs a human headed-browser login — if a browser row fails with
"storageState invalid/expired", (re)create it first:

```bash
cd .scripts/agent-integration-tests
uv run --no-sync python auth_setup.py <shared-app-url> .auth/dogfood.json
```

Then kick off the suite (serial — always `-p no:xdist`; ~1 hr; also runs the
deployed `crash` cases that confirm diagnostics route a traceback to `/logz`):

```bash
cd .scripts/agent-integration-tests
DATABRICKS_CONFIG_PROFILE=dogfood uv run --no-sync pytest validate_templates.py -p no:xdist -v
```

Read results from `logs/validation-report.md` (per-template pass/fail/skip, incl. the
`crash` rows). Subset with `--val-template <name>` (repeatable). For the UI/protocol
functional suite, also run `functional_test.py` (see the `validate-templates` skill).
