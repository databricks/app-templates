import { z } from 'zod';
import type { ChatMessage } from '../types';

const MAX_TEXT_LENGTH = 100_000;
const MAX_PARTS = 50;
const MAX_PREVIOUS_MESSAGES = 10_000;
const MAX_PREVIOUS_PARTS = 50_000;
const MAX_PART_TYPE_LENGTH = 100;
// The AI SDK fetches any other file URL server-side, so file parts must carry
// the image inline.
const IMAGE_DATA_URL = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]*={0,2}$/;

const textPartSchema = z.object({
  type: z.enum(['text']),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

const filePartSchema = z.object({
  type: z.enum(['file']),
  mediaType: z.enum(['image/jpeg', 'image/png']),
  name: z.string().min(1),
  url: z.string().regex(IMAGE_DATA_URL),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

// Any UI message part the client may echo back (text, reasoning, tool-*,
// dynamic-tool, source-*, file, step-start, data-*); other fields pass through.
const previousMessagePartSchema = z
  .looseObject({
    type: z.string().min(1).max(MAX_PART_TYPE_LENGTH),
    text: z.string().max(MAX_TEXT_LENGTH).optional(),
    errorText: z.string().max(MAX_TEXT_LENGTH).optional(),
  })
  .refine(
    (part) =>
      part.type !== 'file' ||
      (typeof part.url === 'string' && IMAGE_DATA_URL.test(part.url)),
    { error: 'File parts must use an image data URL', path: ['url'] },
  );

// Schema for previous messages in ephemeral mode
// More permissive to handle various message types (user, assistant, tool calls, etc.)
const previousMessageSchema = z.object({
  // Accept any string ID: user messages have UUIDs, but assistant messages
  // from the AI SDK use nanoid (16-char alphanumeric), not UUIDs.
  id: z.string(),
  // System prompts are set server-side; clients may not inject them.
  role: z.enum(['user', 'assistant']),
  parts: z.array(previousMessagePartSchema) as unknown as z.ZodType<
    ChatMessage['parts']
  >,
});

// Tool-approval continuations resend the whole conversation. The counts are
// checked before any message is validated: Zod builds an issue for every
// invalid part, so validating an unbounded flood exhausts the server.
const previousMessagesSchema = z
  .array(z.unknown())
  .max(MAX_PREVIOUS_MESSAGES)
  .refine(
    (messages) =>
      messages.reduce<number>((total, message) => {
        const parts = (message as { parts?: unknown } | null)?.parts;
        return total + (Array.isArray(parts) ? parts.length : 0);
      }, 0) <= MAX_PREVIOUS_PARTS,
    { error: `Previous messages can have at most ${MAX_PREVIOUS_PARTS} parts` },
  )
  .pipe(z.array(previousMessageSchema));

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
  previousMessages: previousMessagesSchema.optional(),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;

export const titleRequestBodySchema = z.object({
  message: z.object({
    id: z.string().uuid(),
    role: z.enum(['user']),
    parts: z.array(partSchema).min(1).max(MAX_PARTS),
  }),
});
