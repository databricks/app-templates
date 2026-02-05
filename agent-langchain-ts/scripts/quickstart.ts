#!/usr/bin/env tsx

/**
 * Interactive setup wizard for the LangChain TypeScript agent.
 *
 * Guides users through:
 * - Environment configuration
 * - Databricks authentication
 * - MLflow experiment setup
 * - Dependency installation
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import * as readline from "readline/promises";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

interface Config {
  databricksHost: string;
  databricksToken: string;
  model: string;
  experimentId?: string;
  enableSqlMcp: boolean;
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const promptText = defaultValue
    ? `${question} (${defaultValue}): `
    : `${question}: `;
  const answer = await rl.question(promptText);
  return answer.trim() || defaultValue || "";
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const defaultText = defaultYes ? "Y/n" : "y/N";
  const answer = await rl.question(`${question} (${defaultText}): `);
  const normalized = answer.trim().toLowerCase();

  if (!normalized) return defaultYes;
  return normalized === "y" || normalized === "yes";
}

function execCommand(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8" }).trim();
  } catch (error) {
    return "";
  }
}

function checkDatabricksCli(): boolean {
  try {
    execSync("databricks --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getDatabricksConfig(): { host?: string; token?: string } {
  try {
    const host = execCommand("databricks auth env --host");
    const token = execCommand("databricks auth env --token");
    return { host, token };
  } catch {
    return {};
  }
}

async function setupEnvironment(): Promise<Config> {
  console.log("\n🚀 LangChain TypeScript Agent Setup\n");

  // Check for Databricks CLI
  const hasDbxCli = checkDatabricksCli();
  let config: Config = {
    databricksHost: "",
    databricksToken: "",
    model: "databricks-claude-sonnet-4-5",
    enableSqlMcp: false,
  };

  if (hasDbxCli) {
    console.log("✅ Databricks CLI detected");

    const useCliAuth = await confirm(
      "Use Databricks CLI authentication?",
      true
    );

    if (useCliAuth) {
      const cliConfig = getDatabricksConfig();
      if (cliConfig.host) {
        config.databricksHost = cliConfig.host;
        console.log(`   Host: ${config.databricksHost}`);
      }
      if (cliConfig.token) {
        config.databricksToken = cliConfig.token;
        console.log("   Token: [configured]");
      }
    }
  } else {
    console.log("⚠️  Databricks CLI not found");
    console.log(
      "   Install: https://docs.databricks.com/en/dev-tools/cli/install.html\n"
    );
  }

  // Prompt for host if not set
  if (!config.databricksHost) {
    config.databricksHost = await prompt(
      "Databricks workspace URL",
      "https://your-workspace.cloud.databricks.com"
    );
  }

  // Prompt for token if not set
  if (!config.databricksToken) {
    config.databricksToken = await prompt(
      "Databricks personal access token (dapi...)"
    );
  }

  // Model selection
  console.log("\n📦 Model Configuration");
  const modelOptions = [
    "databricks-claude-sonnet-4-5",
    "databricks-gpt-5-2",
    "databricks-meta-llama-3-3-70b-instruct",
    "custom",
  ];

  console.log("Available models:");
  modelOptions.forEach((model, idx) => {
    console.log(`  ${idx + 1}. ${model}`);
  });

  const modelChoice = await prompt("Select model (1-4)", "1");
  const modelIndex = parseInt(modelChoice) - 1;

  if (modelIndex >= 0 && modelIndex < modelOptions.length - 1) {
    config.model = modelOptions[modelIndex];
  } else if (modelIndex === modelOptions.length - 1) {
    config.model = await prompt("Enter custom model endpoint name");
  }

  console.log(`   Using model: ${config.model}`);

  // MLflow experiment
  console.log("\n📊 MLflow Configuration");
  const createExperiment = await confirm(
    "Create MLflow experiment?",
    true
  );

  if (createExperiment) {
    // Try to create experiment via Databricks CLI
    try {
      const userName = execCommand(
        "databricks current-user me --output json | jq -r .userName"
      );
      const experimentPath = `/Users/${userName}/agent-langchain-ts`;

      console.log(`   Creating experiment: ${experimentPath}`);

      const result = execCommand(
        `databricks experiments create --experiment-name "${experimentPath}" --output json 2>/dev/null || echo "{}"`
      );

      const parsed = JSON.parse(result || "{}");
      config.experimentId = parsed.experiment_id;

      if (config.experimentId) {
        console.log(`   ✅ Experiment created: ${config.experimentId}`);
      } else {
        console.log("   ℹ️  Experiment may already exist");
      }
    } catch (error) {
      console.log("   ⚠️  Could not auto-create experiment");
      config.experimentId = await prompt("Enter experiment ID (optional)");
    }
  } else {
    config.experimentId = await prompt("Enter experiment ID (optional)");
  }

  // MCP configuration
  console.log("\n🔧 MCP Tools Configuration");
  config.enableSqlMcp = await confirm("Enable Databricks SQL MCP tools?", false);

  return config;
}

function writeEnvFile(config: Config): void {
  const envPath = join(process.cwd(), ".env");
  const envExamplePath = join(process.cwd(), ".env.example");

  let envContent = "";

  if (existsSync(envExamplePath)) {
    envContent = readFileSync(envExamplePath, "utf-8");
  }

  // Update environment variables
  const updates: Record<string, string> = {
    DATABRICKS_HOST: config.databricksHost,
    DATABRICKS_TOKEN: config.databricksToken,
    DATABRICKS_MODEL: config.model,
    MLFLOW_TRACKING_URI: "databricks",
    ENABLE_SQL_MCP: config.enableSqlMcp ? "true" : "false",
  };

  if (config.experimentId) {
    updates.MLFLOW_EXPERIMENT_ID = config.experimentId;
  }

  // Replace or append variables
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  writeFileSync(envPath, envContent.trim() + "\n");
  console.log(`\n✅ Environment configuration saved to .env`);
}

async function installDependencies(): Promise<void> {
  console.log("\n📦 Installing dependencies...");

  const installNpm = await confirm("Run npm install?", true);

  if (installNpm) {
    try {
      execSync("npm install", { stdio: "inherit" });
      console.log("✅ Dependencies installed");
    } catch (error) {
      console.error("❌ Failed to install dependencies");
      throw error;
    }
  } else {
    console.log("⚠️  Skipped dependency installation");
    console.log("   Run 'npm install' manually before starting the server");
  }
}

async function main() {
  try {
    // Setup environment
    const config = await setupEnvironment();

    // Write .env file
    writeEnvFile(config);

    // Install dependencies
    await installDependencies();

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("🎉 Setup Complete!");
    console.log("=".repeat(60));
    console.log("\nNext steps:");
    console.log("  1. Review configuration in .env");
    console.log("  2. Start development server:");
    console.log("     npm run dev");
    console.log("  3. Test the agent:");
    console.log("     curl http://localhost:8000/health");
    console.log("  4. Deploy to Databricks:");
    console.log("     databricks bundle deploy -t dev");
    console.log("\n📚 Documentation: README.md");
    console.log("");
  } catch (error) {
    console.error("\n❌ Setup failed:", error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
