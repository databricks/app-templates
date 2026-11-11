import { z } from 'zod';

const MAX_TEXT_LENGTH = 100_000;
const MAX_PARTS = 50;
const MAX_PREVIOUS_MESSAGES = 200;

const textPartSchema = z.object({
  type: z.enum(['text']),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

const filePartSchema = z.object({
  type: z.enum(['file']),
  mediaType: z.enum(['image/jpeg', 'image/png']),
  name: z.string().min(1),
  url: z.string().url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

// Schema for previous messages in ephemeral mode
// More permissive to handle various message types (user, assistant, tool calls, etc.)
const previousMessageSchema = z.object({
  // Accept any string ID: user messages have UUIDs, but assistant messages
  // from the AI SDK use nanoid (16-char alphanumeric), not UUIDs.
  id: z.string(),
  // System prompts are set server-side; clients may not inject them.
  role: z.enum(['user', 'assistant']),
  // Permissive to handle text, tool calls, tool results
  parts: z.array(z.any()).max(MAX_PARTS),
});

export const postRequestBodySchema = z.object({
  id: z.string().uuid(),
  // Optional for continuation/regeneration scenarios (no new user message)
  message: z
    .object({
      id: z.string().uuid(),
      role: z.enum(['user']),
      parts: z.array(partSchema).max(MAX_PARTS),
    })
    .optional(),
  selectedChatModel: z.enum(['chat-model', 'chat-model-reasoning']),
  selectedVisibilityType: z.enum(['public', 'private']),
  // Optional field for ephemeral mode: frontend sends previous conversation history
  previousMessages: z
    .array(previousMessageSchema)
    .max(MAX_PREVIOUS_MESSAGES)
    .optional(),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;

export const titleRequestBodySchema = z.object({
  message: z.object({
    id: z.string().uuid(),
    role: z.enum(['user']),
    parts: z.array(partSchema).min(1).max(MAX_PARTS),
  }),
});
