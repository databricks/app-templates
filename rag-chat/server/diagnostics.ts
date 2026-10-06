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

function disabled(): boolean {
  const v = (process.env.DATABRICKS_APP_DIAGNOSTICS || "").trim().toLowerCase();
  return ["0", "false", "no", "off"].includes(v);
}

export function installDiagnostics(): void {
  if (installed || disabled()) return;
  installed = true;
  try {
    process.on("uncaughtException", (err: Error, origin: unknown) => {
      console.error(`[app.diagnostics] uncaughtException (${String(origin)}):`, err?.stack ?? err);
      process.exit(1); // process is in an undefined state; do not continue
    });
    process.on("unhandledRejection", (reason: unknown) => {
      const r = reason as { stack?: string };
      console.error("[app.diagnostics] unhandledRejection:", r?.stack ?? reason);
    });
    process.on("warning", (w: Error) => {
      console.error("[app.diagnostics] warning:", w?.stack ?? w);
    });
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
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
