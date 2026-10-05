# Template Deploy Validation — Design

**Date:** 2026-09-25
**Status:** Draft (for review; not committed)

## Goal

Provide reusable machinery to validate that app templates in this repo still
deploy and serve correctly. Immediate use: validate the 33 templates changed by
seven in-flight `origin/claude/*` branches (semgrep fixes, npm pinning, Vite 8
upgrades, Dependabot/CI) **as they will land merged together**. Longer-term use:
run the same machinery against arbitrary pull requests (including community PRs)
by checking out the PR and running the deploy loop.

Non-goal: replacing the existing agent e2e suite. Agents keep their richer
contract (see "Scope split").

## Context

- The repo has an existing pytest e2e suite at `.scripts/agent-integration-tests/`
  that validates the **7 agent templates** through quickstart → local run →
  `bundle deploy` → endpoint queries (`/responses`, `/invocations`, OpenAI SDK,
  memory) → `bundle destroy`. Its `helpers.py` holds type-agnostic, battle-tested
  machinery: `_run_cmd`/`_run_with_retries`, `bundle_deploy/run/destroy`,
  `get_oauth_token` (SDK-based; U2M + service principals), `databricks_create_app`,
  `wait_for_app_ready`, `capture_app_logs`, `git_copy_template`, logging.
- Templates fall into two deploy shapes:
  - **DAB templates** (have `databricks.yml`): 21 templates, incl. all 7 agents
    plus JS/appkit ones (`agent-langchain-ts`, `agentic-support-console`,
    `appkit-*` ×6, `content-moderator`, `e2e-chatbot-app-next`,
    `inventory-intelligence`, `rag-chat`, `saas-tracker`, `vacation-rentals`).
  - **`app.yaml`-only templates** (no `databricks.yml`): 12 templates —
    `dash-*` (4), `flask-*` (3), `mcp-server-*` (2), `streamlit-*` (2),
    `nodejs-fastapi-hello-world-app`. Intentionally DAB-free; deployed via the
    Apps API. **We do not add `databricks.yml` to these.**
- CLI confirmed: `databricks apps deploy <APP_NAME> --source-code-path <ws_path>`
  deploys arbitrary uploaded source into an existing app (API path, works without
  `databricks.yml`). `databricks apps create NAME --no-compute --no-wait` creates
  a bare persistent app. `databricks sync` uploads local source to a workspace path.
- Working profile: `dogfood` (Valid=YES). The harness default (`dev`) is not valid
  in this environment — hence profile must be configurable.

## Scope split

| Class | Count | Validation path |
|---|---|---|
| Agent templates | 7 | **Existing `test_e2e.py`** (DAB, full endpoint/memory contract). Unchanged. |
| Non-agent templates | 26 | **New single-app serial deploy loop** (this design). |

The 26 non-agent = 14 DAB JS/appkit + 12 `app.yaml`-only. All 26 are deployed via
the **apps-deploy adapter** into one shared app (their `app.yaml` carries the
runtime command; DAB resources are bypassed for the serve check).

A thin top-level `validate` wrapper can invoke both paths to cover all 33.

## Merged state

Validate against an **ephemeral integration branch**:

1. Branch from `main`.
2. Merge all 7 `origin/claude/*` branches in.
3. **Fail loudly on any merge conflict** (overlap is expected — `great-feynman`
   overlaps semgrep-1/2/3) so conflicts are resolved before validating.
4. Run the validation loop against the working tree.

Because the runner validates the working tree, the same flow serves future PRs:
check out the PR branch, run `deploy`.

## Architecture

Single shared, persistent app. Serial redeploys. Reuses the existing `helpers.py`.

```
.scripts/agent-integration-tests/
  helpers.py               # existing; shared core, imported by new modules
  test_e2e.py              # existing; agents (unchanged)
  validation_config.py     # NEW: registry dataclasses + loader
  validate_templates.py    # NEW: setup + deploy/verify runner (pytest-parametrized, serial)
  validation-config.yaml   # NEW: profile, shared app name, per-template entries
```

(If a rename to a first-class `.scripts/template-validation/` is preferred later,
it is a mechanical move; deferred to avoid churn now.)

### Components

**1. Registry / config (`validation-config.yaml` + `validation_config.py`)**
```yaml
profile: dogfood
shared_app_name: val-template-check
workspace_source_root: /Workspace/Users/<me>/template-validation
templates:
  streamlit-database-app: { verify: html }
  flask-hello-world-app:  { verify: html }
  mcp-server-hello-world: { verify: mcp }
  rag-chat:               { verify: spa }
  appkit-genie:           { verify: spa }
  # ... all 26 non-agent templates
```
`verify` kinds: `html`, `spa`, `mcp`, `api`. (`agent` handled by `test_e2e.py`.)
Deploy adapter is always `apps-deploy` for this loop, so it need not be per-entry.

**2. Deploy adapter (apps-deploy)**
```
deploy(template_dir, shared_app_name, profile, workspace_source_root):
  ws_path = f"{workspace_source_root}/{template_dir.name}"
  1. Prepare source: copy template to temp (git_copy_template so uncommitted
     merge state is included), neutralize app.yaml `valueFrom` env into benign
     placeholder `value`s (reverted concept — done on the temp copy, original
     untouched).
  2. databricks sync <temp_src> <ws_path> -p <profile>
  3. databricks apps deploy <shared_app_name> --source-code-path <ws_path>
       --auto-approve -p <profile>   (with retry/recovery via _run_with_retries)
```
No `destroy` — the app persists and is overwritten by the next template.

**3. One-time setup vs repeatable deploy**
- `setup` (once, idempotent): `databricks apps create <shared_app_name>
  --no-compute --no-wait`; skip if it already exists.
- `deploy` (repeatable, serial): for each registry template → adapter.deploy →
  `wait_for_app_ready_generic` → verify. Re-run after each merge/PR.

**4. Verification (curl-tiered, per `verify` kind)**
- Auth: bearer token from `get_oauth_token(profile)` (SDK). `databricks auth
  token -p <profile>` is the manual equivalent for a first-run sanity check.
- Readiness: `wait_for_app_ready_generic` — polls `databricks apps get` for
  `RUNNING`, then GETs `/` (not `/agent/info`) until non-5xx.
- `html` (streamlit/dash/flask): GET `/` with bearer → assert non-5xx + a basic
  HTML marker (`<html`/`<!doctype`).
- `spa` (node/vite/appkit): GET `/` → parse HTML for referenced hashed
  `*.js`/`*.css` assets → fetch a sample → assert 200. Catches broken Vite builds
  that still serve an HTML shell.
- `mcp` (mcp-server-*): GET the server's health/root or protocol endpoint →
  assert non-5xx.
- `api`: GET a declared health path → assert non-5xx.

### Data flow (one template, in the serial loop)
```
git_copy_template(template @ integration branch) → temp
  → neutralize valueFrom in temp/app.yaml
  → databricks sync temp → <ws_path>
  → databricks apps deploy <shared_app> --source-code-path <ws_path>
  → wait_for_app_ready_generic(<shared_app>) → app_url, token
  → verify(kind, app_url, token)
  → record pass/fail; continue to next template
```

### Error handling
- Reuse `_run_with_retries` + recovery callbacks for `sync`/`deploy` transient
  failures (mirrors `bundle_deploy` recovery).
- On verify failure: `capture_app_logs(shared_app, profile)` before recording,
  for post-mortem (same as the agent harness).
- Per-template failures do not abort the loop; all results collected and reported
  at the end (a template failing to boot must not mask the rest).

## Testing / rollout

1. **Prove on 2** first (before scaling to 26): one `app.yaml`-only
   (`streamlit-database-app`, `verify: html`) and one SPA DAB
   (`rag-chat`, `verify: spa`) against `dogfood`. Confirm: app creation, source
   sync, apps deploy, readiness, bearer-token curl, asset check.
2. Confirm auth end-to-end (a real bearer token reaches the deployed app).
3. Resolve any resource-dependent boot failures surfaced in step 1 (see Risks).
4. Scale to all 26 non-agent templates, serial.
5. Run existing `test_e2e.py` for the 7 agents against the integration branch.

## Risks / open items

- **Resource-dependent boot** (primary risk): templates whose `app.yaml` uses
  `valueFrom` (e.g. `rag-chat`→postgres, `appkit-genie`→genie-space,
  `dash-chatbot`→serving-endpoint) may not boot in a generic shared app.
  Mitigation: neutralize `valueFrom`→placeholder `value` for the serve check
  (validates build/boot/serve, which is what these PRs actually change). Some
  apps may still hard-require a live backend to render; handled case-by-case,
  discovered during "prove on 2".
- **`spa` asset discovery**: relies on the served HTML referencing hashed assets.
  If a template serves assets differently, the check degrades to "200 on `/`";
  refine per template as needed.
- **Single-app serial contention**: acceptable by design (resource savings);
  total runtime ~= 26 × (deploy + readiness + verify), sequentially.
- **Workspace source path**: `workspace_source_root` must be writable by the
  profile's user; confirm on first run.

## Out of scope (now)

- Headless-browser (Playwright) render verification — optional tier 2, deferred
  (browser-into-Databricks-OAuth complexity; Playwright MCP not connected here).
- Local (non-deployed) run of non-agent templates.
- Changing any template's own files (we validate them as-shipped).
- Full parallel deploy across many apps (explicitly rejected for resource reasons).
