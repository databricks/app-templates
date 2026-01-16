import { z } from 'zod';

const textPartSchema = z.object({
  type: z.enum(['text']),
  text: z.string().min(1),
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
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.any()), // Permissive to handle text, tool calls, tool results
});

export const postRequestBodySchema = z.object({
  id: z.string().uuid(),
  // Optional for continuation/regeneration scenarios (no new user message)
  message: z
    .object({
      id: z.string().uuid(),
      role: z.enum(['user']),
      parts: z.array(partSchema),
    })
    .optional(),
  selectedChatModel: z.enum(['chat-model', 'chat-model-reasoning']),
  selectedVisibilityType: z.enum(['public', 'private']),
  // Optional field for ephemeral mode: frontend sends previous conversation history
  previousMessages: z.array(previousMessageSchema).optional(),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
