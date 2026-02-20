/**
 * Express server for the LangChain agent with MLflow tracing.
 *
 * Provides:
 * - /invocations endpoint (MLflow-compatible Responses API)
 * - Health check endpoint
 * - MLflow trace export via OpenTelemetry
 *
 * Note: This server is UI-agnostic. The UI (e2e-chatbot-app-next) runs separately
 * and proxies to /invocations via the API_PROXY environment variable.
 */

import express, { Request, Response } from "express";
import cors from "cors";
import { config } from "dotenv";
import {
  createAgent,
  type AgentConfig,
  type AgentMessage,
} from "./agent.js";
import {
  initializeMLflowTracing,
  setupTracingShutdownHandlers,
} from "./tracing.js";
import { createInvocationsRouter } from "./routes/invocations.js";
import { getMCPServers } from "./mcp-servers.js";
import type { AgentExecutor } from "langchain/agents";

// Load environment variables
config();

/**
 * Server configuration
 */
interface ServerConfig {
  port: number;
  agentConfig: AgentConfig;
}

/**
 * Initialize the Express server
 */
export async function createServer(
  serverConfig: ServerConfig
): Promise<express.Application> {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' })); // Protect against large payload DoS

  // Debug middleware to log incoming headers (helps debug auth issues)
  app.use((req, res, next) => {
    next();
  });

  // Initialize MLflow tracing
  const tracing = await initializeMLflowTracing({
    serviceName: "langchain-agent-ts",
    experimentId: process.env.MLFLOW_EXPERIMENT_ID,
  });

  setupTracingShutdownHandlers(tracing);

  // Initialize agent
  let agent: AgentExecutor | any;
  try {
    agent = await createAgent(serverConfig.agentConfig);
    console.log("✅ Agent initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize agent:", error);
    throw error;
  }

  /**
   * Health check endpoint
   */
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "langchain-agent-ts",
    });
  });

  // Mount /invocations endpoint (MLflow-compatible)
  const invocationsRouter = createInvocationsRouter(agent);
  app.use("/invocations", invocationsRouter);

  console.log("✅ Agent endpoints mounted");

  /**
   * Root endpoint - Service info
   */
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "LangChain Agent TypeScript",
      version: "1.0.0",
      endpoints: {
        health: "GET /health",
        invocations: "POST /invocations (Responses API)",
      },
    });
  });

  return app;
}

/**
 * Start the server
 */
export async function startServer(config: Partial<ServerConfig> = {}) {
  const serverConfig: ServerConfig = {
    port: parseInt(process.env.PORT || "8000", 10),
    agentConfig: {
      model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
      temperature: parseFloat(process.env.TEMPERATURE || "0.1"),
      maxTokens: parseInt(process.env.MAX_TOKENS || "2000", 10),
      useResponsesApi: process.env.USE_RESPONSES_API === "true",
      // Load MCP servers from mcp-servers.ts
      // Configure servers there, similar to Python template
      mcpServers: getMCPServers(),
      ...config.agentConfig,
    },
    ...config,
  };

  const app = await createServer(serverConfig);

  app.listen(serverConfig.port, () => {
    console.log(`\n🚀 Agent Server running on http://localhost:${serverConfig.port}`);
    console.log(`   Health: http://localhost:${serverConfig.port}/health`);
    console.log(`   Invocations API: http://localhost:${serverConfig.port}/invocations`);
    console.log(`\n📊 MLflow tracking enabled`);
    console.log(`   Experiment: ${process.env.MLFLOW_EXPERIMENT_ID || "default"}`);
  });
}

// Start server if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  });
}
