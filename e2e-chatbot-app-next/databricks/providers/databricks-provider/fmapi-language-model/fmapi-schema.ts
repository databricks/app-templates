import { z } from 'zod/v4';

// Zod schemas mirroring FMAPI chat chunk types
export const reasoningSummarySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('summary_text'),
    text: z.string(),
    signature: z.string().optional(),
  }),
  z.object({
    type: z.literal('summary_encrypted_text'),
    data: z.string(),
  }),
]);

export const contentItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    citation: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('image'),
    image_url: z.string(),
  }),
  z.object({
    type: z.literal('reasoning'),
    summary: z.array(reasoningSummarySchema),
  }),
]);

export const fmapiChunkSchema = z.object({
  id: z.string(),
  created: z.number(),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
  object: z.literal('chat.completion.chunk'),
  choices: z.array(
    z.object({
      index: z.number(),
      delta: z.object({
        role: z
          .union([z.literal('assistant'), z.null(), z.undefined()])
          .optional(),
        content: z.union([z.string(), z.array(contentItemSchema)]).optional(),
      }),
      finish_reason: z.union([z.literal('stop'), z.null()]).optional(),
    }),
  ),
});

export const fmapiResponseSchema = z.object({
  id: z.string(),
  created: z.number(),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.union([
          z.literal('assistant'),
          z.literal('user'),
          z.literal('tool'),
        ]),
        content: z.union([z.string(), z.array(contentItemSchema)]).optional(),
      }),
    }),
  ),
});

// Exported types for type-only imports in other modules
export type FmapiChunk = z.infer<typeof fmapiChunkSchema>;
export type FmapiResponse = z.infer<typeof fmapiResponseSchema>;
export type FmapiMessage = FmapiResponse['choices'][number]['message'];
export type FmapiContentItem = z.infer<typeof contentItemSchema>;
