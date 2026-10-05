# Functional E2E Testing — Design (Increment 1: Framework + Exemplars)

**Date:** 2026-10-05
**Status:** Draft (for review)

## Goal / intent

Give reviewers (Databricks employees) a way to run **functional** end-to-end
tests that exercise each template app's **actual behavior** — not just that it
deploys and serves. A chatbot returns a response; a Genie app renders a query
result; a data app loads a table and applies a filter; a RAG app answers; an
MCP server responds to a protocol call; an agent returns a valid response.

- **Depth:** one critical happy-path per app (prove the core function works).
- **Targets:** both a **locally-run** instance (no auth) **and** the **deployed
  Databricks App** (behind SSO).
- **Audience:** reviewers run on demand during review. **Not CI** — requires
  special credentials and real backend resources.
- **Checked in** so the tests travel with the templates and show no regression.
- **End goal:** 100% template coverage, reached **incrementally** by app-type
  waves. This spec covers **Increment 1 only**: the shared framework plus one
  proven exemplar per major app type (local + deployed).

## Approach (agreed: "A")

**Co-located per-template functional tests + a thin orchestrator.** Each
template owns its happy-path test(s) in its own directory, following the
precedent already in the repo (`e2e-chatbot-app-next` and
`agentic-support-console` already ship `playwright.config.ts` + tests). Shared
machinery lives under `.scripts/` and knows how to launch each app **locally by
type**, wait for readiness, run that template's functional test against a given
`baseURL` (with optional saved auth state), and aggregate results into the
markdown report. UI apps use Playwright; agents and MCP servers are exercised
via API/protocol calls (no browser), reusing the `test_e2e.py` approach.

The same assertion suite per template is parameterized by `(baseURL,
storageState?)` and run twice: against the local URL (no state) and against the
deployed app URL (with the operator's saved SSO state).

## App-type families (8) and their functional-test shape

| Family | Templates | Launch locally | Exercise via |
|---|---|---|---|
| Streamlit | `streamlit-*` (6) | `streamlit run app.py --server.port <p>` | Playwright (localhost / deployed) |
| Dash | `dash-*` (6) | `python app.py` (port via env) | Playwright |
| Gradio | `gradio-*` (4) | `python app.py` | Playwright |
| Shiny | `shiny-*` (4) | `python app.py` | Playwright |
| Flask | `flask-*` (3) | `flask --app app.py run --port <p>` | Playwright / HTTP |
| Node/SPA | `appkit-*` (6), `rag-chat`, `agentic-support-console`, `content-moderator`, `saas-tracker`, `vacation-rentals`, `inventory-intelligence`, `e2e-chatbot-app-next`, `nodejs-fastapi-hello-world-app`, `agent-langchain-ts` (15) | `npm run dev` (or build + start) | Playwright |
| MCP servers | `mcp-server-*` (2) | `uv run <server>` | MCP/JSON-RPC client (no browser) |
| Python agents | `agent-langgraph*`, `agent-openai-*`, `agent-non-conversational`, `agent-migration-*` (7) | `uv run start-server` | `/responses` + `/invocations` API (no browser), reusing `test_e2e` |

**Playwright toolchain per family:** Node/SPA templates use **node Playwright**,
co-located, reusing each template's existing `playwright.config.ts`/tests where
present. Python-UI templates (Streamlit/Dash/Gradio/Shiny/Flask) co-locate a
**Playwright-for-Python** test in `tests/e2e/` run via `pytest` (so no node
toolchain is forced into python templates). The orchestrator abstracts "run this
template's functional test" over both.

## Increment 1 exemplars (one per major dimension)

Chosen to prove every framework dimension while keeping the first plan tractable:

1. **`streamlit-database-app`** — Python-UI + Playwright-for-Python; proves
   python local-launch + browser, local & deployed.
2. **`e2e-chatbot-app-next`** — Node/SPA; **reuses its existing Playwright
   suite**; proves node local-launch + browser and reuse of a shipped suite.
3. **`mcp-server-hello-world`** — MCP; proves the non-browser protocol path
   (and needs no special backend creds).
4. **`agent-langgraph`** — Python agent; proves the API path, reusing
   `test_e2e`'s functional endpoint checks.

Each exemplar runs **local** and **deployed** (deployed via the SSO auth-setup).

## Components

### 1. Branch setup (plan Task 1)
Fresh branch off clean `main` (e.g. `feature/functional-e2e`), carrying the 13
validation-tooling commits currently on `feature/template-validation`
(`validate_templates.py`, `validation_config.py`, `validate_transforms.py`,
`validation-config.yaml`, `make-integration-branch.sh`, the report hook in
`conftest.py`). These are additive `.scripts/` files; `main` already has the
base `agent-integration-tests` suite (`helpers.py`, `test_e2e.py`, etc.).

### 2. Functional-test registry (`.scripts/agent-integration-tests/functional_config.py`)
Per-template entry: `name`, `family`, `local_launch` (command + port + readiness
probe), `functional_test` (how to invoke it: node-playwright path, py-playwright
path, mcp, or agent-api), and `required_resources` (which of the 6 backend
resources it needs, reusing the enumeration already produced). Increment 1
registers only the 4 exemplars; later increments add rows.

### 3. Local launcher by family (`.scripts/agent-integration-tests/local_launch.py`)
`launch(template) -> (process, base_url)` per family (streamlit/dash/flask/
gradio/shiny/node/mcp/agent) + `wait_ready(base_url, probe)`; `teardown`.
Reuses `helpers.find_free_port`, `_run_cmd`, process-group kill from
`helpers.stop_server`.

### 4. Playwright wiring
- Node/SPA: invoke the template's own Playwright (`npx playwright test`) with
  `PLAYWRIGHT_BASE_URL` and optional `PLAYWRIGHT_STORAGE_STATE` env.
- Python-UI: a small shared `pytest` + `playwright` (python) harness; per-template
  happy-path specs live in `{template}/tests/e2e/`.
- Browsers installed via `playwright install chromium` (documented one-time step).

### 5. Deployed/SSO auth-setup (`.scripts/agent-integration-tests/auth_setup.py`)
A **headed** Playwright run that opens the deployed app, lets the **human
operator complete Databricks SSO + OAuth consent**, then saves `storageState`
to `.auth/<workspace>.json`. Automated deployed runs load this state.
**`.auth/` is git-ignored** (holds a live session; never committed).

### 6. Orchestrator (extends `validate_templates.py`)
`functional_test(template, target)` where `target ∈ {local, deployed}`:
launch-or-deploy → ready → run functional test (Playwright/MCP/agent-API) →
record result → teardown. Reuses the existing deploy harness for the deployed
target. Serial, pytest-parametrized; reviewers run one template or all.

### 7. Report
Extend the existing markdown report hook to a functional matrix:
`| template | family | local | deployed | notes |`, written to
`logs/functional-report.md`.

## Credentials / how a reviewer runs it
- A `.env` (git-ignored) or CLI profile supplies `DATABRICKS_HOST` + auth and
  the resource identifiers each app needs (serving endpoint, Genie space,
  warehouse, Lakebase, UC volume, experiment — the 6 already enumerated).
- One-time: `playwright install chromium`; for deployed runs,
  `uv run functional-auth-setup` (operator logs in → saves state).
- Run: `uv run pytest functional_test.py --template <name> --target local`
  (and `--target deployed`). Docs in the suite's `AGENTS.md`.

## Error handling
- Launch/readiness failures captured with the app's stderr/log (reuse
  `_run_cmd` logging); deployed failures capture `apps logs` (as today).
- Teardown always runs (process-group kill locally; deployed app persists).
- Per-template failures don't abort the run; results aggregated in the report.

## Testing (how Increment 1 proves itself)
The 4 exemplars run green **local and deployed** = the framework works end to
end across all dimensions (python+browser, node+browser, SSO/storageState,
non-browser API/MCP). Pure helpers (registry loader, launch-command builder,
report renderer) get unit tests; the exemplar runs are the integration proof.

## Roadmap to 100% (later increments, each its own spec+plan)
Increment 2: Streamlit wave (remaining 5). 3: Dash wave (6). 4: Gradio+Shiny
(8). 5: Flask (3 — no Flask exemplar in Increment 1). 6: Node/SPA wave (14
remaining). 7: MCP (1 remaining) + agents (6 remaining, mostly reusing
`test_e2e`). Totals: 4 exemplars + 43 across waves = 47. Each wave authors the
happy-path test per template and registers it.

## Out of scope (Increment 1)
- Functional tests for templates beyond the 4 exemplars (later increments).
- CI integration (explicitly not CI).
- Scripting the SSO login itself (human-in-the-loop by design).
- Exhaustive/comprehensive per-app coverage (happy-path only).
