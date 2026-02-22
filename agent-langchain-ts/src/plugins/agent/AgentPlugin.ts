/**
 * AgentPlugin - Wraps LangChain agent functionality as a plugin
 *
 * Responsibilities:
 * - Initialize MLflow tracing
 * - Create LangChain agent with tools
 * - Inject /invocations and /health routes
 * - Handle graceful shutdown
 */

import { Application, Request, Response } from 'express';
import { Plugin, PluginConfig } from '../Plugin';
import { createAgent, type AgentConfig } from '../../agent.js';
import {
  initializeMLflowTracing,
  setupTracingShutdownHandlers,
  MLflowTracing,
} from '../../tracing.js';
import { createInvocationsRouter } from '../../routes/invocations.js';
import type { AgentExecutor } from 'langchain/agents';

export interface AgentPluginConfig extends PluginConfig {
  /** Agent configuration */
  agentConfig: AgentConfig;

  /** MLflow experiment ID for tracing */
  experimentId?: string;

  /** Service name for tracing */
  serviceName?: string;
}

export class AgentPlugin implements Plugin {
  name = 'agent';
  version = '1.0.0';

  private config: AgentPluginConfig;
  private agent: AgentExecutor | any;
  private tracing?: MLflowTracing;

  constructor(config: AgentPluginConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('[AgentPlugin] Initializing...');

    // Initialize MLflow tracing
    try {
      this.tracing = await initializeMLflowTracing({
        serviceName: this.config.serviceName || 'langchain-agent-ts',
        experimentId: this.config.experimentId || process.env.MLFLOW_EXPERIMENT_ID,
      });

      setupTracingShutdownHandlers(this.tracing);
      console.log('[AgentPlugin] ✓ MLflow tracing initialized');
    } catch (error) {
      console.error('[AgentPlugin] Failed to initialize tracing:', error);
      throw error;
    }

    // Create agent
    try {
      this.agent = await createAgent(this.config.agentConfig);
      console.log('[AgentPlugin] ✓ Agent created successfully');
    } catch (error) {
      console.error('[AgentPlugin] Failed to create agent:', error);
      throw error;
    }
  }

  injectRoutes(app: Application): void {
    console.log('[AgentPlugin] Injecting routes...');

    // Health check endpoint
    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'langchain-agent-ts',
        plugin: this.name,
      });
    });

    // Mount /invocations endpoint (Responses API format)
    const invocationsRouter = createInvocationsRouter(this.agent);
    app.use('/invocations', invocationsRouter);

    console.log('[AgentPlugin] ✓ Routes injected (/health, /invocations)');
  }

  async shutdown(): Promise<void> {
    console.log('[AgentPlugin] Shutting down...');

    // Cleanup tracing
    if (this.tracing) {
      try {
        // The tracing shutdown handlers are already registered
        // Just log that we're cleaning up
        console.log('[AgentPlugin] ✓ Tracing cleanup completed');
      } catch (error) {
        console.error('[AgentPlugin] Error during tracing cleanup:', error);
      }
    }

    console.log('[AgentPlugin] Shutdown complete');
  }
}
