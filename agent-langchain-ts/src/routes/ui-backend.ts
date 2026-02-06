/**
 * Minimal UI backend routes to support the chat frontend
 * These routes provide authentication and configuration for the UI
 */

import { Router, Request, Response } from "express";
import { streamText } from "ai";
import { createDatabricks } from "@databricks/ai-sdk-provider";

export const uiBackendRouter = Router();

// Initialize Databricks AI SDK provider
const databricks = createDatabricks();

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
 * Chat endpoint - proxies to /invocations and converts to AI SDK format
 * The UI expects this endpoint for chat interactions using Vercel AI SDK
 */
uiBackendRouter.post("/chat", async (req: Request, res: Response) => {
  try {
    console.log("[/api/chat] Received request:", JSON.stringify(req.body).slice(0, 200));

    // Convert UI chat format to invocations format
    const messages = req.body.messages || [];

    // Call the agent's invocations endpoint
    const invocationsUrl = `http://localhost:${process.env.PORT || 8000}/invocations`;

    const requestBody = {
      input: messages,
      stream: true,
    };

    console.log("[/api/chat] Calling invocations:", invocationsUrl);
    console.log("[/api/chat] Request body:", JSON.stringify(requestBody).slice(0, 300));

    const response = await fetch(invocationsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[/api/chat] Invocations failed with ${response.status}:`, errorText);
      throw new Error(`Invocations endpoint failed: ${response.status} - ${errorText}`);
    }

    // Set headers for AI SDK streaming (newline-delimited JSON)
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Vercel-AI-Data-Stream", "v1");

    let fullText = "";
    let messageId = `msg_${Date.now()}`;

    // Stream the response and convert Responses API to AI SDK format
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              // Send final message
              const finalData = {
                id: messageId,
                role: "assistant",
                content: fullText,
                createdAt: new Date().toISOString(),
              };
              res.write(`0:${JSON.stringify(finalData)}\n`);
              continue;
            }

            try {
              const event = JSON.parse(data);

              // Handle text deltas
              if (event.type === 'response.output_text.delta') {
                fullText += event.delta;
                // Send text delta in AI SDK format
                res.write(`0:"${event.delta.replace(/\n/g, '\\n').replace(/"/g, '\\"')}"\n`);
              }
              // Handle completion
              else if (event.type === 'response.completed') {
                // Completion handled by [DONE]
              }
            } catch (e) {
              console.error("Error parsing event:", e);
            }
          }
        }
      }
    }

    res.end();
    console.log("[/api/chat] Stream completed");
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
