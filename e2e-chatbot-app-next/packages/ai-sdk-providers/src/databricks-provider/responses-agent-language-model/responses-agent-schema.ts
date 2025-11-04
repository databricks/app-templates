import { z } from 'zod/v4';

/**
 * Response schema
 */
const responsesAgentMessageSchema = z.object({
  type: z.literal('message'),
  role: z.literal('assistant'),
  id: z.string(),
  content: z.array(
    z.object({
      type: z.literal('output_text'),
      text: z.string(),
      logprobs: z.unknown().nullish(),
      annotations: z.array(
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('url_citation'),
            start_index: z.number(),
            end_index: z.number(),
            url: z.string(),
            title: z.string(),
          }),
        ]),
      ),
    }),
  ),
});

const responsesAgentFunctionCallSchema = z.object({
  type: z.literal('function_call'),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string(),
  id: z.string(),
});

const responsesAgentReasoningSchema = z.object({
  type: z.literal('reasoning'),
  id: z.string(),
  encrypted_content: z.string().nullish(),
  summary: z.array(
    z.object({
      type: z.literal('summary_text'),
      text: z.string(),
    }),
  ),
});

const responsesAgentFunctionCallOutputSchema = z.object({
  type: z.literal('function_call_output'),
  call_id: z.string(),
  output: z.any(),
});

const responsesAgentOutputItem = z.discriminatedUnion('type', [
  responsesAgentMessageSchema,
  responsesAgentFunctionCallSchema,
  responsesAgentReasoningSchema,
  responsesAgentFunctionCallOutputSchema,
]);

export const responsesAgentResponseSchema = z.object({
  id: z.string().optional(),
  created_at: z.number().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullish(),
  model: z.string().optional(),
  output: z.array(responsesAgentOutputItem),
});

/**
 * Chunk schema
 */

const textDeltaChunkSchema = z.object({
  type: z.literal('response.output_text.delta'),
  item_id: z.string(),
  delta: z.string(),
  logprobs: z.unknown().nullish(),
});

const errorChunkSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  param: z.string().nullish(),
  sequence_number: z.number(),
});

const responseOutputItemDoneSchema = z.object({
  type: z.literal('response.output_item.done'),
  output_index: z.number(),
  item: responsesAgentOutputItem,
});

const responseAnnotationAddedSchema = z.object({
  type: z.literal('response.output_text.annotation.added'),
  annotation: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('url_citation'),
      url: z.string(),
      title: z.string(),
    }),
  ]),
});

const responseReasoningSummaryTextDeltaSchema = z.object({
  type: z.literal('response.reasoning_summary_text.delta'),
  item_id: z.string(),
  summary_index: z.number(),
  delta: z.string(),
});

const responseFunctionCallArgumentsDeltaSchema = z.object({
  type: z.literal('response.function_call_arguments.delta'),
  item_id: z.string(),
  delta: z.string(),
  output_index: z.number(),
  sequence_number: z.number(),
});

const functionCallOutputChunkSchema = z.object({
  type: z.literal('function_call_output'),
  call_id: z.string(),
  output: z.any(),
});

export const responsesAgentChunkSchema = z.union([
  textDeltaChunkSchema,
  responseOutputItemDoneSchema,
  responseAnnotationAddedSchema,
  responseReasoningSummaryTextDeltaSchema,
  responseFunctionCallArgumentsDeltaSchema,
  functionCallOutputChunkSchema,
  errorChunkSchema,
]);

/**
 * We use a loose schema for response validation to handle unknown chunks.
 */
export const looseResponseAgentChunkSchema = z.union([
  responsesAgentChunkSchema,
  z
    .object({ type: z.string() })
    .loose(), // fallback for unknown chunks
]);

export type ResponsesAgentChunk = z.infer<typeof responsesAgentChunkSchema>;
export type ResponsesAgentMessage = z.infer<typeof responsesAgentMessageSchema>;
export type ResponsesAgentFunctionCall = z.infer<
  typeof responsesAgentFunctionCallSchema
>;
export type ResponsesAgentReasoning = z.infer<
  typeof responsesAgentReasoningSchema
>;
export type ResponsesAgentFunctionCallOutput = z.infer<
  typeof responsesAgentFunctionCallOutputSchema
>;
export type ResponsesAgentOutputItem = z.infer<typeof responsesAgentOutputItem>;
export type ResponsesAgentResponse = z.infer<
  typeof responsesAgentResponseSchema
>;
export type ResponsesAgentError = z.infer<typeof errorChunkSchema>;
