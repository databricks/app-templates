/**
 * Minimal UI backend routes to support the chat frontend
 * These routes provide authentication and configuration for the UI
 */

import { Router, Request, Response } from "express";

export const uiBackendRouter = Router();

/**
 * Session endpoint - returns user info from Databricks headers
 * The UI uses this to check if user is authenticated
 */
uiBackendRouter.get("/session", (req: Request, res: Response) => {
  // In Databricks Apps, authentication headers are automatically injected
  const userId = req.headers["x-forwarded-user"] as string;
  const userEmail = req.headers["x-forwarded-email"] as string;
  const userName = req.headers["x-forwarded-preferred-username"] as string;

  // For local development, use dummy user
  const isDevelopment = process.env.NODE_ENV !== "production";

  if (!userId && !isDevelopment) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  res.json({
    user: {
      id: userId || "local-user",
      email: userEmail || "local@example.com",
      name: userName || "Local User",
    },
  });
});

/**
 * Config endpoint - returns app configuration
 */
uiBackendRouter.get("/config", (_req: Request, res: Response) => {
  res.json({
    appName: "TypeScript LangChain Agent",
    agentEndpoint: "/invocations",
    features: {
      streaming: true,
      toolCalling: true,
    },
  });
});

/**
 * Chat endpoint - proxies to /invocations
 * The UI expects this endpoint for chat interactions
 */
uiBackendRouter.post("/chat", async (req: Request, res: Response) => {
  try {
    // Convert UI chat format to invocations format
    const messages = req.body.messages || [];

    // Call the agent's invocations endpoint
    const invocationsUrl = `http://localhost:${process.env.PORT || 8000}/invocations`;

    const response = await fetch(invocationsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: messages,
        stream: true,
      }),
    });

    // Set headers for SSE streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Stream the response
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    }

    res.end();
  } catch (error) {
    console.error("Error in chat endpoint:", error);
    res.status(500).json({
      error: "Failed to process chat request",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * History endpoint - placeholder (no persistence yet)
 */
uiBackendRouter.get("/history", (_req: Request, res: Response) => {
  res.json({ chats: [] });
});

/**
 * Messages endpoint - placeholder
 */
uiBackendRouter.get("/messages/:chatId", (_req: Request, res: Response) => {
  res.json({ messages: [] });
});
