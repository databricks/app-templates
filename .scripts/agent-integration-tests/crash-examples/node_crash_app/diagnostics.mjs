// GENERATED from .scripts/source/diagnostics.ts by .scripts/sync-scripts.py —
// DO NOT EDIT. Run `python .scripts/sync-scripts.py` to regenerate. Plain-JS
// twin of the TS diagnostics module for the node_crash_app e2e crash fixture
// (runs as raw `node index.mjs`, no TS build). Kept in lockstep by sync-check.

// Crash/exception diagnostics for Node Databricks Apps (zero-dependency).
//
// Databricks Apps run in locked-down pods where you cannot attach debuggers; the
// only reliable diagnostics channel is the app's log stream (stdout/stderr, viewed
// at <app-url>/logz). This routes uncaught errors there. Import this module as the
// VERY FIRST import of your entrypoint — it self-installs on import. Idempotent.
//
// Node is single-threaded, so there is no faulthandler-style hang dump (a wedged
// event loop cannot run a timer); a hang surfaces as a failed health check. The
// SIGTERM handler logs on shutdown/kill. Kill switch: DATABRICKS_APP_DIAGNOSTICS=0.

let installed = false;

function disabled() {
  const v = (process.env.DATABRICKS_APP_DIAGNOSTICS || "").trim().toLowerCase();
  return ["0", "false", "no", "off"].includes(v);
}

export function installDiagnostics() {
  if (installed || disabled()) return;
  installed = true;
  try {
    process.on("uncaughtException", (err , origin ) => {
      console.error(`[app.diagnostics] uncaughtException (${String(origin)}):`, err?.stack ?? err);
      process.exit(1); // process is in an undefined state; do not continue
    });
    // NB: no `process.on("unhandledRejection", ...)`. Registering a listener
    // SUPPRESSES Node's `--unhandled-rejections` policy, and the listener's return
    // value is ignored (so you cannot "rethrow" from it). We deliberately leave it
    // unset: the default policy (`throw`, since Node 15) escalates an unhandled
    // rejection to `uncaughtException` — logged with its stack and exited non-zero
    // by the handler above (origin `unhandledRejection`) — while operators keep the
    // ability to change that behavior via `--unhandled-rejections=<mode>`.
    // NB: no `process.on("warning", ...)` — Node already prints warnings to stderr
    // by default; a second listener would double-print them.
    for (const sig of ["SIGTERM", "SIGINT"] ) {
      process.on(sig, () => {
        console.error(`[app.diagnostics] received ${sig} — shutting down`);
        // Let an app-registered handler / server.close() run; exit if we're last.
        if (process.listenerCount(sig) <= 1) process.exit(143);
      });
    }
    console.error(`[app.diagnostics] installed (pid=${process.pid})`);
  } catch (e) {
    try {
      console.error("[app.diagnostics] install failed:", e);
    } catch {
      /* ignore */
    }
  }
}

installDiagnostics();
