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
import { WorkspaceClient } from "@databricks/sdk-experimental";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

interface Config {
  databricksHost: string;
  configProfile: string;
  model: string;
  experimentId?: string;
}

interface DatabricksProfile {
  name: string;
  host: string;
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

function getValidProfiles(): DatabricksProfile[] {
  try {
    const output = execSync("databricks auth profiles", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const profiles: DatabricksProfile[] = [];
    for (const line of output.trim().split("\n").slice(1)) {
      // Each line: "Name  Host  Valid" with 2+ spaces as separator
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length >= 3 && parts[2].trim() === "YES") {
        profiles.push({ name: parts[0].trim(), host: parts[1].trim() });
      }
    }
    return profiles;
  } catch {
    return [];
  }
}

async function setupEnvironment(): Promise<Config> {
  console.log("\n🚀 LangChain TypeScript Agent Setup\n");

  let config: Config = {
    databricksHost: "",
    configProfile: "",
    model: "databricks-claude-sonnet-4-5",
  };

  // List available Databricks CLI profiles
  console.log("🔍 Looking for Databricks CLI profiles...");
  const profiles = getValidProfiles();

  if (profiles.length > 0) {
    console.log("Found configured profiles:");
    profiles.forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.name}  (${p.host})`);
    });
    console.log(`  ${profiles.length + 1}. Log in with a new profile`);

    const choice = await prompt(
      `Select profile (1-${profiles.length + 1})`,
      "1"
    );
    const idx = parseInt(choice) - 1;

    if (idx >= 0 && idx < profiles.length) {
      config.configProfile = profiles[idx].name;
      config.databricksHost = profiles[idx].host;
      console.log(`   Using profile: ${config.configProfile}`);
    }
  }

  // No profile selected — run `databricks auth login` to set one up
  if (!config.configProfile) {
    const host = await prompt(
      "Databricks workspace URL",
      "https://your-workspace.cloud.databricks.com"
    );
    console.log("\nOpening browser for Databricks login...");
    try {
      execSync(`databricks auth login --host ${host} --profile DEFAULT`, { stdio: "inherit" });
      config.configProfile = "DEFAULT";
      config.databricksHost = host;
      console.log(`   ✅ Logged in and saved as profile: DEFAULT`);
    } catch {
      console.error("❌ Login failed. Run 'databricks auth login' manually and re-run quickstart.");
      process.exit(1);
    }
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
    try {
      const client = new WorkspaceClient({ profile: config.configProfile });

      const me = await client.currentUser.me();
      const experimentPath = `/Users/${me.userName}/agent-langchain-ts`;
      console.log(`   Creating experiment: ${experimentPath}`);

      try {
        const created = await client.experiments.createExperiment({ name: experimentPath });
        config.experimentId = created.experiment_id;
        console.log(`   ✅ Experiment created: ${config.experimentId}`);
      } catch (createError: any) {
        if (createError?.message?.includes("RESOURCE_ALREADY_EXISTS")) {
          const existing = await client.experiments.getByName({ experiment_name: experimentPath });
          config.experimentId = existing.experiment?.experiment_id;
          console.log(`   ✅ Using existing experiment: ${config.experimentId}`);
        } else {
          throw createError;
        }
      }
    } catch (error) {
      console.log("   ⚠️  Could not auto-create experiment:", error);
      config.experimentId = await prompt("Enter experiment ID (optional)");
    }
  } else {
    config.experimentId = await prompt("Enter experiment ID (optional)");
  }

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
    DATABRICKS_MODEL: config.model,
    MLFLOW_TRACKING_URI: "databricks",
  };

  updates.DATABRICKS_CONFIG_PROFILE = config.configProfile;
  // Host and token are in the profile — strip any template placeholders
  envContent = envContent.replace(/^DATABRICKS_HOST=.*\n?/m, "");
  envContent = envContent.replace(/^DATABRICKS_TOKEN=.*\n?/m, "");

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
