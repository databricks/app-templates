---
name: validate-templates
description: "Deploy-validate and functionally exercise the app templates against a shared Databricks App. Use when: (1) reviewing a PR that changes templates, (2) checking which templates deploy and serve, (3) running the e2e/deploy-validation or functional-e2e suites, (4) regenerating the validation report. Repo-dev tool — NOT synced into templates."
---

# Validate Templates (deploy + functional)

Two complementary suites in `.scripts/agent-integration-tests/`, both **serial**
(one shared app) — always pass `-p no:xdist`, never `-n`:

- **Deploy validation** (`validate_templates.py`): deploys each template's source
  into ONE shared app and confirms it serves. `verify: html` loads the app in a
  real browser (SSO storageState) and asserts the per-template `expect` string(s)
  render in the hydrated DOM (so a generic 404 / error page / framework shell
  can't false-pass — `html` templates MUST declare `expect`); `spa` asserts the
  page references built JS/CSS assets (for framework-provided SPAs with no fixed
  text, e.g. the agent chat UI); `mcp`/`api` assert non-5xx and not-login; `build`
  runs `npm ci && npm run build` locally (no deploy); `obo` deploys like `html` but
  its `expect` must be a **success signal** that renders only if the forwarded
  user token's downstream call succeeded (requires the shared app CREATED with the
  OBO scopes — see Prerequisites; obo entries without `expect` are skipped). The same run also includes
  **deployed crash-handling cases** (`test_crash_diagnostics_deployed`, verify `crash`):
  it deploys the `crash-examples/` fixtures, confirms each CRASHES on startup, and
  confirms the diagnostic traceback reaches `<app-url>/logz` — then restores the
  shared app. Writes `logs/validation-report.md`.
- **Functional e2e** (`functional_test.py`): drives each exemplar's real UI/protocol
  (Playwright etc.) `--target local` or `--target deployed`. Writes
  `logs/functional-report.md`.

See `.scripts/agent-integration-tests/AGENTS.md` for module-level detail.

## Prerequisites

1. **Databricks CLI profile** with access to the workspace (default `dogfood`).
   Pass it via `DATABRICKS_CONFIG_PROFILE=<profile>`.
2. **Shared app** `template-e2e-test` (name/profile in `validation-config.yaml`),
   with these resource KEYS bound and granted to its service principal — the keys
   must match what templates reference via `valueFrom`:
   `serving-endpoint`, `sql-warehouse`, `postgres` (Lakebase Autoscaling),
   `database` (Lakebase Provisioned), `genie-space`, `uc-volume`, `experiment`.
3. **SSO storageState** for the deploy/browser and `--target deployed` runs —
   deployed apps sit behind SSO, which can't be scripted headlessly. Create/refresh
   it (one-time human login; expires ~daily):
   ```bash
   cd .scripts/agent-integration-tests
   uv run --no-sync python auth_setup.py \
     https://template-e2e-test-<id>.<region>.databricksapps.com .auth/dogfood.json
   ```
   A row failing with **"app redirected to SSO login — storageState invalid/expired"**
   means re-run `auth_setup.py`.
4. **OBO (`verify: obo`) — the shared app must be CREATED with the on-behalf-of-user
   scopes**, not patched later. Databricks binds the forwarded-token scopes at app
   creation: adding `user_api_scopes` to an existing app (via `apps update`) populates
   `effective_user_api_scopes` but **never** reaches `X-Forwarded-Access-Token` — not
   after redeploy, stop/start, or a fresh consent (verified on dogfood). Create the
   app with `--forward-user-access-token` and the OBO scope union:
   `sql`, `dashboards.genie`, `files.files`, `serving.serving-endpoints`,
   `catalog.connections` (plus the resource bindings above; `catalog.connections`
   also needs a UC connection resource, which `mcp-server-open-api-spec` requires).
   After (re)creating the app, refresh the storageState (step 3) so its session
   carries the new consent.

## Running

```bash
cd .scripts/agent-integration-tests

# Deploy-validate ALL templates (serial; ~1 hr). Writes logs/validation-report.md
DATABRICKS_CONFIG_PROFILE=dogfood uv run --no-sync pytest validate_templates.py -p no:xdist -v

# A subset (repeatable --val-template)
DATABRICKS_CONFIG_PROFILE=dogfood uv run --no-sync pytest validate_templates.py -p no:xdist -v \
  --val-template streamlit-hello-world-app --val-template agent-langgraph

# Only ensure the shared app exists, skip deploys
... --val-setup-only

# Functional e2e (local apps on this machine)
DATABRICKS_CONFIG_PROFILE=dogfood uv run --no-sync pytest functional_test.py -p no:xdist -v --target local
# ...against the deployed shared app
... --target deployed
```

Run long suites with `run_in_background` and tail `logs/validate-<template>.log`.
**Never pipe pytest through `head`/`tail`** — SIGPIPE kills cleanup and leaves
templates dirty. Deploy progress is written to `logs/validate-<template>.log` (not
stdout).

## Interpreting results

`logs/validation-report.md` groups templates by outcome. Expected non-pass buckets
that are **not** template bugs:

- **OBO** (`verify: obo`) — on-behalf-of-user templates (forward the end user's
  token). Not testable here (no user-token forwarding/consent); reported skipped.
- **DAB-only** — templates with no `app.yaml` (databricks.yml only) are skipped:
  the shared-app source deploy can't set their run command. Validate them with
  `databricks bundle deploy` instead.
- **Needs config** — e.g. a UC connection the shared app doesn't have.

A `verify: html` failure that reaches a 502 after the ~240s retry means the app
container never served (crash on startup) — check the app's build/runtime logs in
the Databricks Apps UI (CLI `apps logs` is SSO-blocked). A browser render failure
("did not render app content") means it served something that isn't the app.

## Adding / fixing coverage

- Deploy validation: edit `validation-config.yaml` (`<name>: { verify: html|spa|mcp|api|build|obo }`).
  `html` entries also need `expect:` — a substring (or list) the app renders, e.g.
  `{ verify: html, expect: "Todo List App" }`.
- Functional e2e: add a `FunctionalTemplate` to `functional_config.py`.
- Picking a verify mode: web UI → `html`; API-only (no UI at `/`) → `api`;
  MCP server → `mcp`; node/SPA you only want compiled → `build`; OBO → `obo`.
