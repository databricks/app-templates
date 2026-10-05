# Template Validation Report

**Date:** 2026-09-28
**Rollup branch:** `integration/validate-20260928` — the **6 `semgrep-*` PRs** (semgrep-1…6) merged on the validation tooling, **no conflicts**. (`great-feynman` excluded — it's semgrep 1–4 combined.)
**Runtime:** SPA builds under **Node 22.16.0 / npm 10.9.2** (matches the Databricks Apps runtime), npm registry = `npm-proxy.cloud.databricks.com`. Deploys on the `dogfood` workspace, app `template-e2e-test`.

## Overall: 20 / 26 pass — 5 real build failures, 1 environment-dependent

---

## Deploy + serve — Python/HTML + MCP → 10 / 11 (semgrep-2; unchanged since last run)

All pass: `streamlit-database-app`, `streamlit-postgres-app`, `flask-hello-world-app`, `flask-database-app`, `flask-postgres-app`, `dash-chatbot-app`, `dash-data-app-obo-user`, `dash-database-app`, `dash-postgres-app`, `mcp-server-hello-world`.
- `mcp-server-open-api-spec` — ⚠️ crashes on boot: needs a Unity Catalog connection + volume (`UC_CONNECTION_NAME` unfilled). **Environment, not code.**

---

## Build integrity — SPA / Node → 10 / 15

**Pass (10):** `nodejs-fastapi-hello-world-app`, `rag-chat`, `agent-langchain-ts` ✅ *(fixed by branch-5 update)*, `e2e-chatbot-app-next` ✅ *(proxy block cleared)*, `inventory-intelligence`, `vacation-rentals`, `appkit-files`, `appkit-genie`, `appkit-lakebase`, `appkit-serving`.

**Fail (5) — all in `semgrep-5-vite8`:**

### A. TypeScript build errors — `AnalyticsPage.tsx` (3 templates)
`agentic-support-console`, `appkit-all-in-one`, `appkit-analytics`:
```
AnalyticsPage.tsx: error TS2339: Property 'length' does not exist on type '{}'.
AnalyticsPage.tsx: error TS2322: Type 'unknown' is not assignable to type 'ReactNode'.
AnalyticsPage.tsx: error TS7053: Element implicitly has an 'any' type … index type '{}'.
```
The analytics data value is typed as `{}`, so `.length`, indexing, and rendering it as a React child all fail the stricter Vite-8 TS build. **Fix:** annotate the analytics query result with its real type instead of `{}`. Likely one shared component fixes all three.

### B. Dependency resolution — `ERESOLVE` (2 templates)
`content-moderator`, `saas-tracker`:
```
npm error code ERESOLVE — Could not resolve dependency:
peer vite@"^5.2.0 || ^6 || ^7 || ^8" from @tailwindcss/vite@4.2.2   (Found: vite@undefined)
```
These are the **only two SPA templates without a committed `package-lock.json`**, so they run `npm install` (fresh peer resolution) instead of `npm ci` — every sibling that has a lockfile passes. **Fix:** commit a `package-lock.json` for both (generated with npm 10), which pins a resolvable tree and lets `npm ci` run. (The proxy's vite metadata may aggravate the fresh resolve, but a lockfile makes it moot and the build reproducible.)

---

## Not yet run — Agents (7, semgrep-1)
`agent-langgraph`, `agent-langgraph-advanced`, `agent-openai-agents-sdk`, `agent-openai-agents-sdk-multiagent`, `agent-openai-advanced`, `agent-non-conversational`, `agent-migration-from-model-serving` — via `test_e2e.py`. Pending.

---

## Rollup by PR
| PR | Result |
| --- | --- |
| semgrep-1-agent-templates | ⏳ 7 agents pending (test_e2e.py) |
| semgrep-2-python-apps | ✅ 10/11 deploy+serve (mcp-open-api needs a UC connection — env) |
| semgrep-3-js-code | ✅ covered templates build/serve |
| semgrep-4-npm-pins | ✅ covered templates build |
| **semgrep-5-vite8** | ⚠️ **5 real failures**: 3× `AnalyticsPage.tsx` TS errors, 2× `ERESOLVE` (missing lockfile) |
| semgrep-6-ci | ✅ CI workflow only; merges clean |
