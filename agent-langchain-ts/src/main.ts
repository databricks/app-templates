/**
 * Unified Server Entry Point
 *
 * Provides a plugin-based architecture for composing Agent + UI in multiple modes:
 * - Mode 1: Both plugins (in-process) - Production recommended
 * - Mode 2: Agent-only
 * - Mode 3: UI-only (with external agent proxy)
 */

import express, { type Application } from 'express';
import { config as loadEnv } from 'dotenv';
import { PluginManager, type PluginContext } from './plugins/index.js';
import { AgentPlugin, type AgentPluginConfig } from './plugins/agent/index.js';
import { UIPlugin, type UIPluginConfig } from './plugins/ui/index.js';
import { getMCPServers } from './mcp-servers.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
loadEnv();

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Server configuration options
 */
export interface UnifiedServerOptions {
  /** Enable AgentPlugin */
  agentEnabled?: boolean;

  /** Enable UIPlugin */
  uiEnabled?: boolean;

  /** Server port */
  port?: number;

  /** Agent-specific configuration */
  agentConfig?: Partial<AgentPluginConfig>;

  /** UI-specific configuration */
  uiConfig?: Partial<UIPluginConfig>;

  /** Environment (development, production, test) */
  environment?: string;
}

/**
 * Create a unified server with configurable plugins
 *
 * @param options - Server configuration options
 * @returns Express app, plugin manager, and port
 */
export async function createUnifiedServer(
  options: UnifiedServerOptions = {}
): Promise<{
  app: Application;
  pluginManager: PluginManager;
  port: number;
}> {
  const {
    agentEnabled = true,
    uiEnabled = true,
    port = parseInt(process.env.PORT || '8000', 10),
    agentConfig = {},
    uiConfig = {},
    environment = process.env.NODE_ENV || 'development',
  } = options;

  console.log('\n🚀 Creating Unified Server');
  console.log(`   Mode: ${agentEnabled ? 'Agent' : ''}${agentEnabled && uiEnabled ? ' + ' : ''}${uiEnabled ? 'UI' : ''}`);
  console.log(`   Port: ${port}`);
  console.log(`   Environment: ${environment}\n`);

  // Create Express app
  const app = express();

  // Create plugin context
  const context: PluginContext = {
    environment,
    port,
    config: {},
  };

  // Create plugin manager
  const pluginManager = new PluginManager(app, context);

  // Register AgentPlugin if enabled
  if (agentEnabled) {
    const agentPluginConfig: AgentPluginConfig = {
      agentConfig: {
        model: process.env.DATABRICKS_MODEL || 'databricks-claude-sonnet-4-5',
        temperature: parseFloat(process.env.TEMPERATURE || '0.1'),
        maxTokens: parseInt(process.env.MAX_TOKENS || '2000', 10),
        useResponsesApi: process.env.USE_RESPONSES_API === 'true',
        mcpServers: getMCPServers(),
        ...agentConfig.agentConfig,
      },
      experimentId: process.env.MLFLOW_EXPERIMENT_ID,
      serviceName: 'langchain-agent-ts',
      ...agentConfig,
    };

    pluginManager.register(new AgentPlugin(agentPluginConfig));
  }

  // Register UIPlugin if enabled
  if (uiEnabled) {
    const isDevelopment = environment === 'development';

    const uiPluginConfig: UIPluginConfig = {
      isDevelopment,
      staticFilesPath: path.join(__dirname, '..', 'ui', 'client', 'dist'),
      agentInvocationsUrl: uiConfig.agentInvocationsUrl,
      ...uiConfig,
    };

    pluginManager.register(new UIPlugin(uiPluginConfig));
  }

  // Initialize all plugins
  await pluginManager.initialize();

  // Inject routes from all plugins
  await pluginManager.injectAllRoutes();

  return { app, pluginManager, port };
}

/**
 * Start the unified server
 *
 * @param options - Server configuration options
 */
export async function startUnifiedServer(
  options: UnifiedServerOptions = {}
): Promise<void> {
  const { app, port } = await createUnifiedServer(options);

  app.listen(port, () => {
    console.log(`\n✅ Unified Server running on http://localhost:${port}`);

    if (options.agentEnabled !== false) {
      console.log(`   Agent Endpoints:`);
      console.log(`     - Health: http://localhost:${port}/health`);
      console.log(`     - Invocations: http://localhost:${port}/invocations`);
    }

    if (options.uiEnabled !== false) {
      console.log(`   UI Endpoints:`);
      console.log(`     - Chat API: http://localhost:${port}/api/chat`);
      console.log(`     - Session API: http://localhost:${port}/api/session`);
      console.log(`     - Frontend: http://localhost:${port}/`);
    }

    if (options.agentEnabled !== false && process.env.MLFLOW_EXPERIMENT_ID) {
      console.log(`\n📊 MLflow Tracking:`);
      console.log(`   Experiment: ${process.env.MLFLOW_EXPERIMENT_ID}`);
    }

    console.log('\n');
  });
}

/**
 * Deployment mode configurations
 */
export const DeploymentModes = {
  /**
   * Mode 1: In-Process (Both Plugins) - Production Recommended
   * Single process, both /invocations and /api/chat available
   */
  inProcess: (): UnifiedServerOptions => ({
    agentEnabled: true,
    uiEnabled: true,
  }),

  /**
   * Mode 2: Agent-Only
   * Just /invocations and /health endpoints
   */
  agentOnly: (port: number = 5001): UnifiedServerOptions => ({
    agentEnabled: true,
    uiEnabled: false,
    port,
  }),

  /**
   * Mode 3: UI-Only (with external agent proxy)
   * UI proxies to external agent server
   */
  uiOnly: (
    port: number = 3001,
    agentUrl: string = 'http://localhost:5001/invocations'
  ): UnifiedServerOptions => ({
    agentEnabled: false,
    uiEnabled: true,
    port,
    uiConfig: {
      agentInvocationsUrl: agentUrl,
    },
  }),
};

// Start server if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Determine mode from environment or default to in-process
  const mode = process.env.SERVER_MODE || 'in-process';

  let options: UnifiedServerOptions;

  switch (mode) {
    case 'agent-only':
      options = DeploymentModes.agentOnly();
      break;
    case 'ui-only':
      options = DeploymentModes.uiOnly(
        undefined,
        process.env.AGENT_INVOCATIONS_URL
      );
      break;
    case 'in-process':
    default:
      options = DeploymentModes.inProcess();
      break;
  }

  startUnifiedServer(options).catch((error) => {
    console.error('❌ Failed to start unified server:', error);
    process.exit(1);
  });
}
