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
 * Supports both text content and tool calls in message history
 */
const responsesRequestSchema = z.object({
  input: z.array(
    z.union([
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.union([
          z.string(),
          z.array(
            z.union([
              // Text content parts
              z.object({
                type: z.string(),
                text: z.string(),
              }).passthrough(),
              // Tool call parts (no text field required)
              z.object({
                type: z.string(),
              }).passthrough(),
            ])
          ),
        ]),
      }),
      z.object({ type: z.string() }).passthrough(),
    ])
  ),
  stream: z.boolean().optional().default(true),
  custom_inputs: z.record(z.string(), z.any()).optional(),
});

/**
 * Helper function to emit SSE events
 */
function emitSSEEvent(res: Response, type: string, data: any) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

/**
 * Helper function to emit both .added and .done events for an output item
 */
function emitOutputItem(res: Response, itemType: string, item: any) {
  emitSSEEvent(res, "response.output_item.added", { item: { ...item, type: itemType } });
  emitSSEEvent(res, "response.output_item.done", { item: { ...item, type: itemType } });
}

/**
 * Create invocations router with the given agent
 */
export function createInvocationsRouter(agent: AgentExecutor): ReturnType<typeof Router> {
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

      // Handle both string and array content formats
      let userInput: string;
      if (Array.isArray(lastUserMessage.content)) {
        // Extract text from array format (multimodal content)
        userInput = lastUserMessage.content
          .filter((part: any) => part.type === "input_text" || part.type === "text")
          .map((part: any) => part.text)
          .join("\n");
      } else {
        userInput = lastUserMessage.content as string;
      }

      // Normalize chat history messages to have string content
      // This is required because Chat Completions API only accepts strings,
      // but Responses API sends array content format
      //
      // IMPORTANT: Include function call context for followup questions
      // Handle BOTH message objects AND top-level tool call objects
      const chatHistory = input.slice(0, -1).map((item: any) => {
        // Handle top-level function_call and function_call_output objects
        // These are sent by the Databricks provider when using API_PROXY
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

        // Handle regular message objects
        if (Array.isArray(item.content)) {
          // Extract text from text parts
          const textParts = item.content
            .filter((part: any) =>
              part.type === "input_text" ||
              part.type === "output_text" ||
              part.type === "text"
            )
            .map((part: any) => part.text);

          // Extract tool call information from content array
          // (for formats that embed tool calls inside message content)
          const toolParts = item.content
            .filter((part: any) =>
              part.type === "function_call" ||
              part.type === "function_call_output" ||
              part.type === "tool-call" ||
              part.type === "tool-result"
            )
            .map((part: any) => {
              // Responses API format
              if (part.type === "function_call") {
                return `[Tool Call: ${part.name}(${JSON.stringify(part.arguments)})]`;
              } else if (part.type === "function_call_output") {
                return `[Tool Result: ${part.output}]`;
              }
              // AI SDK ModelMessage format
              else if (part.type === "tool-call") {
                return `[Tool Call: ${part.toolName}(${JSON.stringify(part.input || part.args)})]`;
              } else if (part.type === "tool-result") {
                return `[Tool Result: ${typeof part.output === 'string' ? part.output : JSON.stringify(part.output)}]`;
              }
              return "";
            });

          // Combine text and tool context
          const allParts = [...textParts, ...toolParts].filter(p => p.length > 0);

          return {
            ...item,
            content: allParts.join("\n"),
          };
        }
        return item;
      });

      // Handle streaming response
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        let textOutputId = `text_${Date.now()}`;
        const toolCallIds = new Map<string, string>(); // Map tool name to call_id

        try {
          // Stream events from agent
          const eventStream = agent.streamEvents(
            {
              input: userInput,
              chat_history: chatHistory,
            },
            { version: "v2" }
          );

          for await (const event of eventStream) {
            // Handle tool calls
            if (event.event === "on_tool_start") {
              const toolCallId = `call_${Date.now()}`;
              const fcId = `fc_${Date.now()}`;

              // Store the call_id for this tool so we can reference it in the output
              const toolKey = `${event.name}_${event.run_id}`;
              toolCallIds.set(toolKey, toolCallId);

              // Emit both .added and .done events for function_call
              emitOutputItem(res, "function_call", {
                id: fcId,
                call_id: toolCallId,
                name: event.name,
                arguments: JSON.stringify(event.data?.input || {}),
              });
            }

            // Handle tool results
            if (event.event === "on_tool_end") {
              // Look up the original call_id for this tool
              const toolKey = `${event.name}_${event.run_id}`;
              const toolCallId = toolCallIds.get(toolKey) || `call_${Date.now()}`;

              // Emit both .added and .done events for function_call_output
              emitOutputItem(res, "function_call_output", {
                id: `fc_output_${Date.now()}`,
                call_id: toolCallId,
                output: JSON.stringify(event.data?.output || ""),
              });

              // Clean up the stored call_id
              toolCallIds.delete(toolKey);
            }

            // Handle text streaming from LLM
            if (event.event === "on_chat_model_stream") {
              const content = event.data?.chunk?.content;
              if (content && typeof content === "string") {
                const textDelta = {
                  type: "response.output_text.delta",
                  item_id: textOutputId,
                  delta: content,
                };
                res.write(`data: ${JSON.stringify(textDelta)}\n\n`);
              }
            }
          }

          // Clean up any remaining tool call tracking
          toolCallIds.clear();

          // Send completion event
          res.write(
            `data: ${JSON.stringify({ type: "response.completed" })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          res.end();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("Streaming error:", error);

          // Clean up tool call tracking on error
          toolCallIds.clear();

          // Send proper SSE completion events
          res.write(
            `data: ${JSON.stringify({ type: "error", error: message })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({ type: "response.failed" })}\n\n`
          );
          res.write("data: [DONE]\n\n");
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
