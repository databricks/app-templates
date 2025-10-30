import { z } from 'zod/v4';

// Tool call schema
const chatAgentToolCallSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
  id: z.string(),
});

// Message schemas (discriminated by role)
const chatAgentAssistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string(), // required, empty string allowed
  id: z.string(),
  name: z.string().optional(),
  tool_calls: z.array(chatAgentToolCallSchema).optional(),
});

const chatAgentToolMessageSchema = z.object({
  role: z.literal('tool'),
  name: z.string(),
  content: z.string(),
  tool_call_id: z.string(),
  id: z.string(),
  attachments: z.record(z.string(), z.unknown()).optional(),
});

const chatAgentUserMessageSchema = z.object({
  role: z.literal('user'),
  content: z.string(),
  id: z.string(),
});

export const chatAgentMessageSchema = z.discriminatedUnion('role', [
  chatAgentAssistantMessageSchema,
  chatAgentToolMessageSchema,
  chatAgentUserMessageSchema,
]);

// Stream chunk schema (used for SSE parsing)
export const chatAgentChunkSchema = z.object({
  id: z.string(),
  delta: chatAgentMessageSchema,
});

// Full response schema (not used in streaming handler, but kept for completeness)
export const chatAgentResponseSchema = z.object({
  id: z.string(),
  messages: z.array(chatAgentMessageSchema),
});

export type ChatAgentChunk = z.infer<typeof chatAgentChunkSchema>;
export type ChatAgentMessage = z.infer<typeof chatAgentMessageSchema>;
export type ChatAgentResponse = z.infer<typeof chatAgentResponseSchema>;
export type ChatAgentToolCall = z.infer<typeof chatAgentToolCallSchema>;
export type ChatAgentToolMessage = z.infer<typeof chatAgentToolMessageSchema>;
export type ChatAgentUserMessage = z.infer<typeof chatAgentUserMessageSchema>;
