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
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import {
  createAgent,
  type AgentConfig,
} from "../agent.js";
import {
  initializeMLflowTracing,
  type MLflowTracing,
} from "./tracing.js";
import { createInvocationsRouter } from "./routes/invocations.js";
import { getMCPServers } from "../mcp-servers.js";
import { closeMCPClient } from "../tools.js";
import type { AgentInterface } from "./agent-interface.js";

// Load environment variables
config();

/**
 * Server configuration
 */
interface ServerConfig {
  port: number;
  agentConfig: AgentConfig;
}

const SERVICE_INFO = {
  service: "LangChain Agent TypeScript",
  version: "1.0.0",
  endpoints: {
    health: "GET /health",
    invocations: "POST /invocations (Responses API)",
  },
};

/**
 * Register SIGINT/SIGTERM handlers that flush tracing and close MCP connections.
 */
function setupShutdownHandlers(tracing: MLflowTracing): void {
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    try {
      await closeMCPClient();
      await tracing.flush();
      await tracing.shutdown();
      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("beforeExit", () => tracing.flush());
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

  // Initialize MLflow tracing
  const tracing = await initializeMLflowTracing({
    serviceName: "langchain-agent-ts",
    experimentId: process.env.MLFLOW_EXPERIMENT_ID,
  });

  setupShutdownHandlers(tracing);

  // Initialize agent
  let agent: AgentInterface;
  try {
    agent = await createAgent(serverConfig.agentConfig);
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

  // Mount handler at /invocations (MLflow) and /responses (OpenAI SDK compatibility)
  const invocationsRouter = createInvocationsRouter(agent);
  app.use("/invocations", invocationsRouter);
  app.use("/responses", invocationsRouter);

  console.log("✅ Agent endpoints mounted (/invocations, /responses)");

  // Production UI serving (optional - only if UI is deployed)
  const uiBackendUrl = process.env.UI_BACKEND_URL;
  if (uiBackendUrl) {
    console.log(`🔗 Proxying /api/* to UI backend: ${uiBackendUrl}`);

    // Proxy /api/* routes to UI backend server
    app.use("/api/*path", async (req, res) => {
      try {
        const targetUrl = `${uiBackendUrl}${req.originalUrl}`;
        const response = await fetch(targetUrl, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
        });

        // Copy response headers
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });

        res.status(response.status);

        // Stream response body
        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
      } catch (error) {
        console.error("Error proxying to UI backend:", error);
        res.status(502).json({ error: "Bad Gateway" });
      }
    });

    // Serve UI static files from ui/client/dist
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const uiDistPath = path.join(__dirname, "..", "..", "..", "ui", "client", "dist");

    if (existsSync(uiDistPath)) {
      console.log(`📂 Serving UI static files from: ${uiDistPath}`);
      app.use(express.static(uiDistPath));

      // SPA fallback - serve index.html for all non-API routes
      app.get("*path", (_req: Request, res: Response) => {
        res.sendFile(path.join(uiDistPath, "index.html"));
      });
    } else {
      console.warn(`⚠️  UI dist path not found: ${uiDistPath}`);
      app.get("/", (_req: Request, res: Response) => { res.json(SERVICE_INFO); });
    }
  } else {
    // Agent-only mode: service info at root
    app.get("/", (_req: Request, res: Response) => { res.json(SERVICE_INFO); });
  }

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
