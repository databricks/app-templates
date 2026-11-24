import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Project } from "@playwright/test";

const PORT = 8770;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

if (!process.env.DATABRICKS_CONFIG_PROFILE && !process.env.DATABRICKS_HOST) {
  throw new Error(
    "Neither DATABRICKS_CONFIG_PROFILE nor DATABRICKS_HOST is set. Set the workspace profile, or the host and credentials in CI, then run the tests again.",
  );
}

function cli(...args: string[]) {
  return JSON.parse(execFileSync("databricks", [...args, "-o", "json"], { cwd: REPO_ROOT, encoding: "utf8" }));
}

const variables = cli("bundle", "validate").variables;
const signedIn = cli("current-user", "me");
const appToken = process.env.APP_TOKEN;

/** Deployed app with bearer token; tracing off to avoid recording it. */
function deployedProject(token: string): Project {
  const appName = variables.agent_app_name.value;
  return {
    name: "deployed",
    testDir: "tests/e2e/deployed",
    use: {
      baseURL: cli("apps", "get", appName).url,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
      trace: "off",
    },
  };
}

/** Local runs with CLI user's email; deployed only when APP_TOKEN is set. */
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 90_000 },
  globalSetup: "./tests/global-setup.ts",
  use: {
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "local",
      testIgnore: ["deployed/**"],
      use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        extraHTTPHeaders: {
          "X-Forwarded-Email": signedIn.userName,
          "X-Forwarded-Access-Token": "local-test",
        },
        trace: "retain-on-failure",
      },
    },
    ...(appToken ? [deployedProject(appToken)] : []),
  ],
  webServer: appToken
    ? undefined
    : {
        command: "uv run start-server",
        cwd: "../app",
        env: { PORT: String(PORT) },
        url: `http://127.0.0.1:${PORT}/`,
        timeout: 120_000,
        reuseExistingServer: false,
      },
});
