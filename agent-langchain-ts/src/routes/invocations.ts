/**
 * MLflow-compatible /invocations endpoint for the LangChain agent.
 *
 * This endpoint provides a standard Responses API interface that:
 * - Accepts Responses API request format
 * - Runs the LangChain agent
 * - Streams events in Responses API format (SSE)
 */

import { Router, type Request, type Response } from "express";
import type { AgentExecutor } from "langchain/agents";
import { z } from "zod";

/**
 * Responses API request schema
 */
const responsesRequestSchema = z.object({
  input: z.array(
    z.union([
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
      z.object({ type: z.string() }).passthrough(),
    ])
  ),
  stream: z.boolean().optional().default(true),
  custom_inputs: z.record(z.string(), z.any()).optional(),
});

type RouterType = ReturnType<typeof Router>;

/**
 * Create invocations router with the given agent
 */
export function createInvocationsRouter(agent: AgentExecutor): RouterType {
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

      const { input, stream } = parsed.data;

      // Extract user input and chat history from Responses API format
      const userMessages = input.filter((msg: any) => msg.role === "user");
      if (userMessages.length === 0) {
        return res.status(400).json({
          error: "No user message found in input",
        });
      }

      const lastUserMessage = userMessages[userMessages.length - 1];
      const userInput = lastUserMessage.content;
      const chatHistory = input.slice(0, -1);

      // Handle streaming response
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        try {
          // Stream events from agent
          const eventStream = agent.streamEvents(
            {
              input: userInput,
              chat_history: chatHistory,
            },
            { version: "v2" }
          );

          let textOutputId = `text_${Date.now()}`;
          let hasStartedText = false;

          for await (const event of eventStream) {
            // Handle tool calls
            if (event.event === "on_tool_start") {
              const toolCallId = `call_${Date.now()}`;
              const toolEvent = {
                type: "response.output_item.done",
                item: {
                  type: "function_call",
                  id: `fc_${Date.now()}`,
                  call_id: toolCallId,
                  name: event.name,
                  arguments: JSON.stringify(event.data?.input || {}),
                },
              };
              res.write(`data: ${JSON.stringify(toolEvent)}\n\n`);
            }

            // Handle tool results
            if (event.event === "on_tool_end") {
              const toolCallId = `call_${Date.now()}`;
              const toolOutputEvent = {
                type: "response.output_item.done",
                item: {
                  type: "function_call_output",
                  call_id: toolCallId,
                  output: JSON.stringify(event.data?.output || ""),
                },
              };
              res.write(`data: ${JSON.stringify(toolOutputEvent)}\n\n`);
            }

            // Handle text streaming from LLM
            if (event.event === "on_chat_model_stream") {
              const content = event.data?.chunk?.content;
              if (content && typeof content === "string") {
                if (!hasStartedText) {
                  hasStartedText = true;
                }
                const textDelta = {
                  type: "response.output_text.delta",
                  item_id: textOutputId,
                  delta: content,
                };
                res.write(`data: ${JSON.stringify(textDelta)}\n\n`);
              }
            }
          }

          // Send completion event
          res.write(
            `data: ${JSON.stringify({ type: "response.completed" })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          res.end();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Streaming error:", error);
          res.write(
            `data: ${JSON.stringify({ type: "error", error: message })}\n\n`
          );
          res.end();
        }
      } else {
        // Non-streaming response
        const result = await agent.invoke({
          input: userInput,
          chat_history: chatHistory,
        });

        res.json({
          output: result.output,
          intermediate_steps: result.intermediateSteps,
        });
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
