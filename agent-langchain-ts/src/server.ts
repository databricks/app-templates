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

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    const authHeaders = {
      'x-forwarded-user': req.headers['x-forwarded-user'],
      'x-forwarded-email': req.headers['x-forwarded-email'],
      'x-forwarded-preferred-username': req.headers['x-forwarded-preferred-username'],
      'authorization': req.headers['authorization'] ? '[present]' : undefined,
    };
    console.log(`[${req.method}] ${req.path}`, authHeaders);
    next();
  });

  // Initialize MLflow tracing
  const tracing = initializeMLflowTracing({
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

  // Reverse proxy for /api/* routes to UI backend
  const uiBackendUrl = process.env.UI_BACKEND_URL;
  if (uiBackendUrl) {
    console.log(`🔗 Proxying /api/* to UI backend at ${uiBackendUrl}`);
    app.use("/api", async (req: Request, res: Response) => {
      try {
        // Add /api back to the URL since Express strips the mount path
        const targetUrl = `${uiBackendUrl}/api${req.url}`;
        console.log(`[PROXY] ${req.method} /api${req.url} -> ${targetUrl}`);

        // Build headers from request
        const headers: Record<string, string> = {};
        Object.entries(req.headers).forEach(([key, value]) => {
          // Skip content-length as it will be recalculated by fetch
          if (key.toLowerCase() === 'content-length') return;

          if (typeof value === "string") {
            headers[key] = value;
          } else if (Array.isArray(value)) {
            headers[key] = value.join(", ");
          }
        });
        headers["host"] = new URL(uiBackendUrl).host;
        headers["content-type"] = "application/json";

        console.log(`[PROXY] Forwarding with headers:`, {
          'x-forwarded-user': headers['x-forwarded-user'],
          'x-forwarded-email': headers['x-forwarded-email'],
        });

        // Forward the request to UI backend
        const bodyStr = req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined;
        const response = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: bodyStr,
        });

        console.log(`[PROXY] Response status: ${response.status}`);

        // Copy status and headers
        res.status(response.status);
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });

        // Stream the response body
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
          }
        }

        res.end();
      } catch (error) {
        console.error("Proxy error:", error);
        res.status(502).json({ error: "Bad Gateway - UI backend unavailable" });
      }
    });
  }

  // Check if UI build exists and mount it
  const uiClientPath = path.join(__dirname, "../../ui/client/dist");

  if (existsSync(uiClientPath)) {
    console.log("📦 UI client found, serving static files...");

    // Serve static UI files
    app.use(express.static(uiClientPath));

    // SPA fallback - serve index.html for all non-API routes
    // This must come AFTER API routes are mounted
    app.get(/^\/(?!api|invocations|health).*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(uiClientPath, "index.html"));
    });

    console.log("✅ UI static files served");
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
