// Intentional-crash fixture for the diagnostics e2e test. NOT a real template.
// Installs the diagnostics bootstrap, then crashes so the test can confirm the
// stack trace reaches stderr (the Databricks Apps log stream). CRASH_MODE selects
// the failure. Every crash carries the marker DIAGNOSTICS_E2E_CANARY.
import { installDiagnostics } from "./diagnostics.mjs";

installDiagnostics();

const CANARY = "DIAGNOSTICS_E2E_CANARY";
const mode = process.env.CRASH_MODE || "startup";

if (mode === "rejection") {
  // Unhandled promise rejection -> with no unhandledRejection listener, Node's
  // default policy (throw) escalates it to uncaughtException, which the diagnostics
  // handler logs (stack) and exits non-zero. No explicit exit here: the crash must
  // come from diagnostics, so the test genuinely proves rejections surface as crashes.
  Promise.reject(new Error(`${CANARY}: induced unhandled rejection`));
} else {
  // "startup": thrown error -> uncaughtException handler logs the stack, exits 1.
  throw new Error(`${CANARY}: induced startup crash`);
}
