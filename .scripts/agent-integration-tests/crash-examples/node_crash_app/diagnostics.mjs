// Crash/exception diagnostics for Node Databricks Apps (zero-dependency).
//
// Databricks Apps run in locked-down pods where you cannot attach debuggers; the
// only reliable diagnostics channel is the app's log stream (stdout/stderr). This
// routes uncaught errors there. Call installDiagnostics() as the very first thing
// in your entrypoint. Idempotent and safe.
//
// Note: Node is single-threaded, so there is no faulthandler-style hang dump — a
// wedged event loop cannot run a timer. A hang surfaces as a failed health check;
// the SIGTERM handler logs on shutdown/kill. Kill switch: DATABRICKS_APP_DIAGNOSTICS=0.

let installed = false;

function disabled() {
  const v = (process.env.DATABRICKS_APP_DIAGNOSTICS || "").trim().toLowerCase();
  return ["0", "false", "no", "off"].includes(v);
}

export function installDiagnostics() {
  if (installed || disabled()) return;
  installed = true;
  try {
    process.on("uncaughtException", (err, origin) => {
      console.error(`[app.diagnostics] uncaughtException (${origin}):`, err && err.stack ? err.stack : err);
      process.exit(1); // process is in an undefined state; do not continue
    });
    process.on("unhandledRejection", (reason) => {
      const stack = reason && reason.stack ? reason.stack : reason;
      console.error("[app.diagnostics] unhandledRejection:", stack);
      // Preserve Node's default crash-on-rejection (default since Node 15):
      // registering this listener suppresses it, so exit non-zero ourselves.
      process.exit(1);
    });
    // NB: no `process.on("warning", ...)` — Node already prints warnings to stderr
    // by default; a second listener would double-print them.
    for (const sig of ["SIGTERM", "SIGINT"]) {
      process.on(sig, () => {
        console.error(`[app.diagnostics] received ${sig} — shutting down`);
        // Let any app-registered handler / server.close() run; exit if we're the last.
        if (process.listenerCount(sig) <= 1) process.exit(143);
      });
    }
    console.error(`[app.diagnostics] installed (pid=${process.pid})`);
  } catch (e) {
    try { console.error("[app.diagnostics] install failed:", e); } catch (_) {}
  }
}
