/**
 * Express server for the LangChain agent with MLflow tracing.
 *
 * Provides:
 * - /invocations endpoint (MLflow-compatible Responses API)
 * - /api/chat endpoint (legacy streaming)
 * - UI routes (from workspace, if available)
 * - Static file serving for UI
 * - Health check endpoint
 * - MLflow trace export via OpenTelemetry
 */

import express, { Request, Response } from "express";
import cors from "cors";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import {
  createAgent,
  invokeAgent,
  streamAgent,
  type AgentConfig,
  type AgentMessage,
} from "./agent.js";
import {
  initializeMLflowTracing,
  setupTracingShutdownHandlers,
} from "./tracing.js";
import { createInvocationsRouter } from "./routes/invocations.js";
import type { AgentExecutor } from "langchain/agents";

// Load environment variables
config();

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Request body for agent invocation
 */
interface AgentRequest {
  messages: AgentMessage[];
  stream?: boolean;
  config?: Partial<AgentConfig>;
}

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
  app.use(express.json());

  // Initialize MLflow tracing
  const tracing = initializeMLflowTracing({
    serviceName: "langchain-agent-ts",
    experimentId: process.env.MLFLOW_EXPERIMENT_ID,
  });

  setupTracingShutdownHandlers(tracing);

  // Initialize agent
  let agent: AgentExecutor;
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

  // Check if UI build exists and mount it
  const uiBuildPath = path.join(__dirname, "../../ui/server/dist");
  const uiClientPath = path.join(__dirname, "../../ui/client/dist");

  if (existsSync(uiBuildPath) && existsSync(uiClientPath)) {
    console.log("📦 UI build found, mounting UI routes...");

    try {
      // Import and mount UI routes dynamically
      const uiIndexModule = await import(path.join(uiBuildPath, "index.js"));

      // Mount UI API routes
      if (uiIndexModule.chatRouter) app.use("/api/chat", uiIndexModule.chatRouter);
      if (uiIndexModule.historyRouter) app.use("/api/history", uiIndexModule.historyRouter);
      if (uiIndexModule.sessionRouter) app.use("/api/session", uiIndexModule.sessionRouter);
      if (uiIndexModule.messagesRouter) app.use("/api/messages", uiIndexModule.messagesRouter);
      if (uiIndexModule.configRouter) app.use("/api/config", uiIndexModule.configRouter);

      // Serve static UI files
      app.use(express.static(uiClientPath));

      // SPA fallback - serve index.html for all non-API routes
      app.get(/^\/(?!api|invocations|health).*/, (_req: Request, res: Response) => {
        res.sendFile(path.join(uiClientPath, "index.html"));
      });

      console.log("✅ UI routes mounted");
    } catch (error) {
      console.warn("⚠️  Failed to mount UI routes:", error);
      console.log("   Agent will run without UI");
    }
  } else {
    console.log("ℹ️  UI build not found, running agent-only mode");
  }

  /**
   * Root endpoint (if no UI)
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
      mcpConfig: {
        enableSql: process.env.ENABLE_SQL_MCP === "true",
        ucFunction: process.env.UC_FUNCTION_CATALOG && process.env.UC_FUNCTION_SCHEMA
          ? {
              catalog: process.env.UC_FUNCTION_CATALOG,
              schema: process.env.UC_FUNCTION_SCHEMA,
              functionName: process.env.UC_FUNCTION_NAME,
            }
          : undefined,
        vectorSearch: process.env.VECTOR_SEARCH_CATALOG && process.env.VECTOR_SEARCH_SCHEMA
          ? {
              catalog: process.env.VECTOR_SEARCH_CATALOG,
              schema: process.env.VECTOR_SEARCH_SCHEMA,
              indexName: process.env.VECTOR_SEARCH_INDEX,
            }
          : undefined,
        genieSpace: process.env.GENIE_SPACE_ID
          ? {
              spaceId: process.env.GENIE_SPACE_ID,
            }
          : undefined,
      },
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
