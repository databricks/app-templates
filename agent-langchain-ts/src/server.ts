/**
 * Express server for the LangChain agent with MLflow tracing.
 *
 * Provides:
 * - REST API endpoint for agent invocations
 * - Server-Sent Events (SSE) for streaming responses
 * - Health check endpoint
 * - MLflow trace export via OpenTelemetry
 */

import express, { Request, Response } from "express";
import cors from "cors";
import { config } from "dotenv";
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
import type { AgentExecutor } from "langchain/agents";

// Load environment variables
config();

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

  /**
   * Agent invocation endpoint
   *
   * POST /api/chat
   * Body: { messages: [...], stream?: boolean, config?: {...} }
   *
   * - If stream=true: Returns SSE stream
   * - If stream=false: Returns JSON response
   */
  app.post("/api/chat", async (req: Request, res: Response) => {
    try {
      const { messages, stream = false, config: requestConfig }: AgentRequest = req.body;

      // Validate request
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          error: "Invalid request: 'messages' array is required",
        });
      }

      // Extract user input (last message should be from user)
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role !== "user") {
        return res.status(400).json({
          error: "Last message must be from 'user'",
        });
      }

      const userInput = lastMessage.content;
      const chatHistory = messages.slice(0, -1);

      // Handle streaming response
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        try {
          for await (const chunk of streamAgent(
            agent,
            userInput,
            chatHistory
          )) {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }

          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Streaming error:", error);
          res.write(
            `data: ${JSON.stringify({ error: message })}\n\n`
          );
          res.end();
        }

        return;
      }

      // Handle non-streaming response
      const response = await invokeAgent(agent, userInput, chatHistory);

      res.json({
        message: {
          role: "assistant",
          content: response.output,
        },
        intermediateSteps: response.intermediateSteps,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Agent error:", error);
      res.status(500).json({
        error: "Internal server error",
        message,
      });
    }
  });

  /**
   * Root endpoint
   */
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "LangChain Agent TypeScript",
      version: "1.0.0",
      endpoints: {
        health: "GET /health",
        chat: "POST /api/chat",
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
    console.log(`\n🚀 Server running on http://localhost:${serverConfig.port}`);
    console.log(`   Health: http://localhost:${serverConfig.port}/health`);
    console.log(`   Chat API: http://localhost:${serverConfig.port}/api/chat`);
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
