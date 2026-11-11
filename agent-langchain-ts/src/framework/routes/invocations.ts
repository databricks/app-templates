/**
 * MLflow-compatible /invocations endpoint (also aliased as /responses).
 *
 * This endpoint provides a standard Responses API interface that:
 * - Accepts Responses API request format (including the OpenAI SDK wire format)
 * - Parses the request into simplified InvokeParams for the agent
 * - Streams/returns events produced by AgentInterface.stream() / AgentInterface.invoke()
 *
 * The agent owns the translation from its SDK's format → ResponseStreamEvent.
 * This file is purely a pass-through layer.
 */

import { Router, type Request, type Response } from "express";
import type { AgentInterface } from "../agent-interface.js";
import { z } from "zod";

const MAX_TEXT_LENGTH = 100_000;
// Tool arguments and results (e.g. query results) can be larger than chat text.
const MAX_TOOL_DATA_LENGTH = 1_000_000;
const MAX_CONTENT_PARTS = 50;
const MAX_INPUT_ITEMS = 500;
const MAX_ID_LENGTH = 256;

const text = z.string().max(MAX_TEXT_LENGTH);
const toolData = z.string().max(MAX_TOOL_DATA_LENGTH);
const id = z.string().max(MAX_ID_LENGTH);

const contentPartSchema = z.union([
  z.object({ type: z.enum(["input_text", "output_text", "text"]), text }),
  z.object({
    type: z.literal("function_call"),
    name: id,
    arguments: z.union([toolData, z.record(z.string(), z.unknown())]),
  }),
  z.object({ type: z.literal("function_call_output"), output: toolData }),
]);

const messageItemSchema = z.object({
  type: z.literal("message").optional(),
  id: id.optional(),
  // "system" is accepted for compatibility (the chat UI sends its title prompt
  // as one) but is never passed to the agent as a system message; see below.
  role: z.enum(["user", "assistant", "system"]),
  content: z.union([text, z.array(contentPartSchema).max(MAX_CONTENT_PARTS)]),
});

const inputItemSchema = z.union([
  messageItemSchema,
  z.object({
    type: z.literal("function_call"),
    id: id.optional(),
    call_id: id.optional(),
    name: id,
    arguments: toolData,
  }),
  z.object({
    type: z.literal("function_call_output"),
    call_id: id.optional(),
    output: toolData,
  }),
  z.object({
    type: z.literal("reasoning"),
    id: id.optional(),
    summary: z
      .array(z.object({ type: z.literal("summary_text"), text }))
      .max(MAX_CONTENT_PARTS),
  }),
  z.object({
    type: z.literal("mcp_approval_request"),
    id,
    name: id,
    arguments: toolData,
    server_label: id.optional(),
  }),
  z.object({
    type: z.literal("mcp_approval_response"),
    id: id.optional(),
    approval_request_id: id,
    approve: z.boolean(),
    reason: text.optional(),
  }),
]);

/**
 * Responses API request schema.
 *
 * Accepts both the MLflow format (input as array of messages) and the
 * OpenAI SDK wire format (input as string or array, optional model field).
 */
const responsesRequestSchema = z.object({
  input: z.union([text, z.array(inputItemSchema).max(MAX_INPUT_ITEMS)]),
  stream: z.boolean().optional().default(true),
  // Accept (and ignore) model field sent by the OpenAI SDK
  model: z.string().optional(),
});

/**
 * Create invocations router with the given agent.
 * Mount at both /invocations (MLflow) and /responses (OpenAI SDK compatibility).
 */
export function createInvocationsRouter(agent: AgentInterface): ReturnType<typeof Router> {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    try {
      // Parse and validate request
      const parsed = responsesRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid request format",
          details: parsed.error.format(),
        });
      }

      const { stream } = parsed.data;

      // Normalise input: string → single user message
      const input =
        typeof parsed.data.input === "string"
          ? [{ role: "user" as const, content: parsed.data.input }]
          : parsed.data.input;

      // Extract the latest user message
      const userMessages = input.filter(
        (msg): msg is z.infer<typeof messageItemSchema> =>
          "role" in msg && msg.role === "user"
      );
      if (userMessages.length === 0) {
        return res.status(400).json({
          error: "No user message found in input",
        });
      }

      const lastUserMessage = userMessages[userMessages.length - 1];

      // Handle both string and array content formats
      let userInput: string;
      if (Array.isArray(lastUserMessage.content)) {
        userInput = lastUserMessage.content
          .filter((part: any) => part.type === "input_text" || part.type === "text")
          .map((part: any) => part.text)
          .join("\n");
      } else {
        userInput = lastUserMessage.content as string;
      }

      // Convert Responses API input to simple chat history for the agent.
      // Preserve tool call context for followup questions.
      const chatHistory = input.slice(0, -1).map((item: any) => {
        // The agent's system prompt is set server-side; caller-supplied system
        // messages are treated as user turns so they can't override it.
        if (item.role === "system") {
          item = { ...item, role: "user" };
        }

        if (item.type === "function_call") {
          return {
            role: "assistant",
            content: `[Tool Call: ${item.name}(${item.arguments})]`,
          };
        } else if (item.type === "function_call_output") {
          return {
            role: "assistant",
            content: `[Tool Result: ${item.output}]`,
          };
        }

        if (Array.isArray(item.content)) {
          const textParts = item.content
            .filter((part: any) =>
              part.type === "input_text" ||
              part.type === "output_text" ||
              part.type === "text"
            )
            .map((part: any) => part.text);

          const toolParts = item.content
            .filter((part: any) =>
              part.type === "function_call" ||
              part.type === "function_call_output"
            )
            .map((part: any) => {
              if (part.type === "function_call") {
                return `[Tool Call: ${part.name}(${JSON.stringify(part.arguments)})]`;
              } else if (part.type === "function_call_output") {
                return `[Tool Result: ${part.output}]`;
              }
              return "";
            });

          const allParts = [...textParts, ...toolParts].filter((p) => p.length > 0);
          return { ...item, content: allParts.join("\n") };
        }
        return item;
      });

      const agentParams = { input: userInput, chat_history: chatHistory };

      // Streaming response: write each ResponseStreamEvent directly as SSE
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        try {
          for await (const event of agent.stream(agentParams)) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          }
          res.write("data: [DONE]\n\n");
          res.end();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Streaming error:", error);
          res.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "response.failed" })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      } else {
        // Non-streaming response: return output items directly
        const items = await agent.invoke(agentParams);
        res.json({ output: items });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Agent invocation error:", error);
      res.status(500).json({
        error: "Internal server error",
        message,
      });
    }
  });

  return router;
}
