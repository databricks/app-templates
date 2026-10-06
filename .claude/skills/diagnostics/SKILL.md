---
name: diagnostics
description: "Diagnose a crashed, hung, or erroring deployed Databricks App. Use when: (1) an app is crashed / UNAVAILABLE / 502s, (2) an app hangs or is unresponsive, (3) you need the stack trace behind a failure, (4) questions about reading app logs or the diagnostics env toggles."
---

# Diagnosing a crashed / hung deployed app

Every template installs a zero-dependency diagnostics bootstrap at startup
(`app_diagnostics.py` for Python, `diagnostics.ts` for Node) that routes crash,
unhandled-exception, and shutdown stack traces to **stderr** — the app's log
stream. When an app crashes or hangs, read those logs to find the cause.

## Reading the logs

**On SSO workspaces (e.g. dogfood staging) the `databricks apps logs` CLI is
blocked** (websocket 302). Read the app's own log viewer in the browser instead:

```
https://<app-url>/logz
```

Open it while signed in (SSO). You'll see the stdout/stderr stream, including the
diagnostics records. On a non-SSO workspace the CLI works:

```bash
databricks apps logs <app-name> --follow --profile <profile>
databricks apps get <app-name> --output json | jq '.app_status'   # state + message
```

## What to look for

- `app.diagnostics: diagnostics: installed (pid=…)` — the bootstrap ran.
- `CRITICAL app.diagnostics: Unhandled exception` + `Traceback (most recent call
  last)` — a Python crash/unhandled exception, with the stack and the failing line.
- `Unhandled exception in thread <name>` — a worker-thread crash.
- `received SIGTERM — dumping all thread stacks` followed by per-thread tracebacks
  — the platform terminated the app (OOM, health-check failure, scale-down); the
  dump shows what every thread was doing at that moment (how you locate a **hang**
  that got killed).
- Node: `[app.diagnostics] uncaughtException: …` / `unhandledRejection: …` with the
  JS stack.

## Diagnosing a hang (Python)

A hung app usually gets killed by the platform; the **SIGTERM all-thread dump**
(above) shows where it was stuck — check that first. To capture stacks *before*
termination, enable the periodic watchdog and redeploy (no pod access needed):

```yaml
# app.yaml
env:
  - name: DATABRICKS_APP_DIAGNOSTICS_HANG_TIMEOUT
    value: "120"   # dump all thread stacks every 120s while wedged
```

If you can signal the pod, `kill -USR1 <pid>` triggers an on-demand all-thread
dump. Node is single-threaded — a wedged event loop can't self-dump; a hang shows
as a failed health check, and the SIGTERM log is your signal.

## Environment toggles

| Var | Default | Effect |
|---|---|---|
| `DATABRICKS_APP_DIAGNOSTICS` | on | `0`/`false` disables all diagnostics |
| `DATABRICKS_APP_DIAGNOSTICS_LOG_LEVEL` | `INFO` | diagnostics log level |
| `DATABRICKS_APP_DIAGNOSTICS_HANG_TIMEOUT` | unset | seconds; enables the periodic all-thread hang dump (Python) |

## Notes

- The bootstrap is installed as the first thing in each entrypoint (top of
  `app.py` / `agent_server/start_server.py` / the Node entry), so even
  import-time/startup crashes are captured.
- It never raises into your app and is idempotent.
- Why not `pyspy`/`gdb`/`strace`? Apps pods are locked down (no `ptrace` /
  `CAP_SYS_PTRACE`, no package install), so in-process stdlib logging is the only
  reliable approach.
- Runnable crash fixtures + the e2e crash test live in
  `.scripts/agent-integration-tests/crash-examples/`.
