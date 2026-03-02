/**
 * get-experiment-id.ts
 *
 * Looks up the MLflow experiment name associated with your Databricks agent
 * deployment so you can set the experiment name in databricks.yml.
 *
 * Usage:
 *   npx tsx scripts/get-experiment-id.ts --endpoint <serving-endpoint-name>
 *   npx tsx scripts/get-experiment-id.ts --agent-brick <agent-brick-name>
 *   npx tsx scripts/get-experiment-id.ts --app <databricks-app-name>
 *
 * The experiment name is printed to stdout on success, suitable for use in
 * your databricks.yml experiment resource:
 *   experiment:
 *     name: "<output of this script>"
 *     permission: CAN_EDIT
 */

import { execSync } from 'node:child_process';

function usage(): never {
  console.error(`Usage: npx tsx scripts/get-experiment-id.ts [options]

Get the MLflow experiment name for your agent deployment.

Options:
  --endpoint <name>      Serving endpoint name (custom agent or Agent Bricks endpoint)
  --agent-brick <name>   Agent Bricks name (Knowledge Assistant or Multi-Agent Supervisor)
  --app <name>           Databricks App name

Examples:
  npx tsx scripts/get-experiment-id.ts --endpoint my-agent-endpoint
  npx tsx scripts/get-experiment-id.ts --agent-brick my-agent-brick
  npx tsx scripts/get-experiment-id.ts --app db-chatbot-dev-myname

Once you have the experiment name, set it in databricks.yml:
  - name: experiment
    experiment:
      name: "<experiment-name>"
      permission: CAN_EDIT`);
  process.exit(1);
}

function getHost(): string {
  try {
    const output = execSync('databricks auth describe --output json', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output) as { details?: { host?: string } };
    const host = parsed?.details?.host;
    if (!host) {
      console.error(
        "❌ Could not determine Databricks host. Run 'databricks auth login' first.",
      );
      process.exit(1);
    }
    return host;
  } catch {
    console.error(
      "❌ Could not determine Databricks host. Run 'databricks auth login' first.",
    );
    process.exit(1);
  }
}

function getToken(host: string): string {
  try {
    const output = execSync(
      `databricks auth token --host "${host}" --output json`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const parsed = JSON.parse(output) as { access_token?: string };
    const token = parsed?.access_token;
    if (!token) {
      console.error(
        "❌ Could not obtain a Databricks token. Run 'databricks auth login' first.",
      );
      process.exit(1);
    }
    return token;
  } catch {
    console.error(
      "❌ Could not obtain a Databricks token. Run 'databricks auth login' first.",
    );
    process.exit(1);
  }
}

async function resolveExperimentName(
  host: string,
  token: string,
  experimentId: string,
): Promise<string> {
  const resp = await fetch(
    `${host}/api/2.0/mlflow/experiments/get?experiment_id=${encodeURIComponent(experimentId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (resp.ok) {
    const data = (await resp.json()) as {
      experiment?: { name?: string };
    };
    if (data.experiment?.name) return data.experiment.name;
  }
  // Fall back to the numeric ID if name lookup fails
  return experimentId;
}

async function handleEndpoint(
  host: string,
  token: string,
  value: string,
): Promise<void> {
  console.error(`🔍 Looking up experiment for serving endpoint: ${value}`);
  let endpointJson: string;
  try {
    endpointJson = execSync(
      `databricks serving-endpoints get "${value}" --output json`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch {
    console.error(`❌ Serving endpoint not found: ${value}`);
    process.exit(1);
  }

  const endpoint = JSON.parse(endpointJson) as {
    tags?: Array<{ key: string; value: string }>;
  };
  const experimentId = (endpoint.tags ?? []).find(
    (t) => t.key === 'MONITOR_EXPERIMENT_ID',
  )?.value;

  if (!experimentId) {
    console.error(
      `❌ No MONITOR_EXPERIMENT_ID tag found on endpoint '${value}'.`,
    );
    console.error(
      '   This endpoint may not have an associated MLflow experiment.',
    );
    console.error(
      '   Only custom-code agents and Agent Bricks endpoints emit this tag.',
    );
    process.exit(1);
  }

  console.log(await resolveExperimentName(host, token, experimentId));
}

async function handleAgentBrick(
  host: string,
  token: string,
  value: string,
): Promise<void> {
  console.error(`🔍 Looking up experiment for Agent Bricks: ${value}`);
  const resp = await fetch(
    `${host}/api/2.0/tiles/get?name=${encodeURIComponent(value)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    console.error(`❌ Agent Bricks API error (${resp.status}): ${err}`);
    process.exit(1);
  }

  const data = (await resp.json()) as {
    mlflow_experiment_id?: string;
    message?: string;
  };
  if (data.message) {
    console.error(`❌ Agent Bricks API error: ${data.message}`);
    process.exit(1);
  }

  const experimentId = data.mlflow_experiment_id;
  if (!experimentId) {
    console.error(
      `❌ No mlflow_experiment_id found for agent brick '${value}'.`,
    );
    console.error('   Make sure the agent brick name is correct.');
    process.exit(1);
  }

  console.log(await resolveExperimentName(host, token, experimentId));
}

async function handleApp(
  host: string,
  token: string,
  value: string,
): Promise<void> {
  console.error(`🔍 Looking up experiment resource for Databricks App: ${value}`);
  let appJson: string;
  try {
    appJson = execSync(`databricks apps get "${value}" --output json`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    console.error(`❌ App not found: ${value}`);
    process.exit(1);
  }

  const app = JSON.parse(appJson) as {
    resources?: Array<{ experiment?: { experiment_id?: string } }>;
  };
  const experimentId = (app.resources ?? []).find((r) => r.experiment != null)
    ?.experiment?.experiment_id;

  if (!experimentId) {
    console.error(
      `❌ No MLflow experiment resource found on app '${value}'.`,
    );
    console.error(
      '   Configure an experiment resource in databricks.yml and redeploy.',
    );
    process.exit(1);
  }

  console.log(await resolveExperimentName(host, token, experimentId));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let mode: 'endpoint' | 'agent-brick' | 'app' | null = null;
  let value = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--endpoint' && args[i + 1]) {
      mode = 'endpoint';
      value = args[++i];
    } else if (args[i] === '--agent-brick' && args[i + 1]) {
      mode = 'agent-brick';
      value = args[++i];
    } else if (args[i] === '--app' && args[i + 1]) {
      mode = 'app';
      value = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      usage();
    } else {
      console.error(`❌ Unknown option: ${args[i]}`);
      usage();
    }
  }

  if (!mode) usage();

  const host = getHost();
  const token = getToken(host);

  switch (mode) {
    case 'endpoint':
      await handleEndpoint(host, token, value);
      break;
    case 'agent-brick':
      await handleAgentBrick(host, token, value);
      break;
    case 'app':
      await handleApp(host, token, value);
      break;
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
