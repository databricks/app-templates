# Crash examples — diagnostics test fixtures

These are **not** app templates. They are intentional-crash fixtures (one Python,
one Node) used by the e2e **crash-diagnostics** test (`test_crash_diagnostics.py`)
to prove that the diagnostics bootstrap (`.scripts/source/app_diagnostics.py` /
the Node `diagnostics.mjs`) routes a crash's stack trace to **stderr** — the
Databricks Apps log stream — so a crashed/hung deployed app can be diagnosed.

Their success criterion is the **opposite** of the deploy-validation suite: a run
passes when the app **crashes** *and* the diagnostic traceback is captured in the
logs (not when it serves). Do not deploy these to production.

## Apps

- `python_crash_app/` — imports `app_diagnostics`, calls `install_diagnostics()`,
  then crashes. `CRASH_MODE` selects the failure: `startup` (default, unhandled
  exception at import), `thread` (exception in a worker thread), `sigterm` (sends
  itself SIGTERM to exercise the shutdown stack dump). The diagnostics module is
  the canonical one in `.scripts/source/app_diagnostics.py`; the test provides it
  on `PYTHONPATH` (and copies it in for deploy runs), so it is not vendored here.
- `node_crash_app/` — imports `./diagnostics.mjs`, calls `installDiagnostics()`,
  then crashes. `CRASH_MODE`: `startup` (default, thrown error → `uncaughtException`)
  or `rejection` (unhandled promise rejection). `diagnostics.mjs` is the canonical
  Node diagnostics module and lives here for now.

Every crash message contains the marker `DIAGNOSTICS_E2E_CANARY`, which the test
asserts appears in the captured logs alongside traceback evidence.

## Run locally

```bash
# Python (from this dir)
PYTHONPATH=../../source python python_crash_app/app.py        # exits non-zero, prints traceback
PYTHONPATH=../../source CRASH_MODE=thread python python_crash_app/app.py

# Node
node node_crash_app/index.mjs                                 # exits 1, prints stack

# Or via the e2e test (local, no deploy/SSO needed):
uv run --no-sync pytest test_crash_diagnostics.py -v
```
