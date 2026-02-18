import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider';
import {
  type ParseResult,
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import type { DatabricksLanguageModelConfig } from '../databricks-language-model';
import {
  responsesAgentResponseSchema,
  looseResponseAgentChunkSchema,
  type responsesAgentChunkSchema,
} from './responses-agent-schema';
import {
  convertResponsesAgentChunkToMessagePart,
  convertResponsesAgentResponseToMessagePart,
} from './responses-convert-to-message-parts';
import { convertToResponsesInput } from './responses-convert-to-input';
import { getDatabricksLanguageModelTransformStream } from '../stream-transformers/databricks-stream-transformer';

export class DatabricksResponsesAgentLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2';

  readonly modelId: string;

  private readonly config: DatabricksLanguageModelConfig;

  constructor(modelId: string, config: DatabricksLanguageModelConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  readonly supportedUrls: Record<string, RegExp[]> = {};

  async doGenerate(
    options: Parameters<LanguageModelV2['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    const networkArgs = await this.getArgs({
      config: this.config,
      options,
      stream: false,
      modelId: this.modelId,
    });

    const { value: response } = await postJsonToApi({
      ...networkArgs,
      successfulResponseHandler: createJsonResponseHandler(
        responsesAgentResponseSchema,
      ),
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: z.any(), // TODO: Implement error schema
        errorToMessage: (error) => JSON.stringify(error), // TODO: Implement error to message
        isRetryable: () => false,
      }),
    });

    return {
      content: convertResponsesAgentResponseToMessagePart(response),
      finishReason: 'stop',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      warnings: [],
    };
  }

  async doStream(
    options: Parameters<LanguageModelV2['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
    const networkArgs = await this.getArgs({
      config: this.config,
      options,
      stream: true,
      modelId: this.modelId,
    });

    const { responseHeaders, value: response } = await postJsonToApi({
      ...networkArgs,
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: z.any(), // TODO: Implement error schema
        errorToMessage: (error) => JSON.stringify(error), // TODO: Implement error to message
        isRetryable: () => false,
      }),
      successfulResponseHandler: createEventSourceResponseHandler(
        looseResponseAgentChunkSchema,
      ),
      abortSignal: options.abortSignal,
    });

    let finishReason: LanguageModelV2FinishReason = 'unknown';

    const allParts: LanguageModelV2StreamPart[] = [];

    // Create a mutable object to capture trace_id and span_id from streaming events
    // This object will be mutated as the stream is consumed
    const responseBody: Record<string, unknown> = {};

    return {
      stream: response
        .pipeThrough(
          new TransformStream<
            ParseResult<z.infer<typeof responsesAgentChunkSchema>>,
            LanguageModelV2StreamPart
          >({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
            },

            transform(chunk, controller) {
              if (options.includeRawChunks) {
                controller.enqueue({ type: 'raw', rawValue: chunk.rawValue });
              }

              // handle failed chunk parsing / validation:
              if (!chunk.success) {
                finishReason = 'error';
                controller.enqueue({ type: 'error', error: chunk.error });
                return;
              }

              // Extract trace info from response.output_item.done event
              // The endpoint returns trace info in databricks_output.trace.info
              if (chunk.value.type === 'response.output_item.done') {
                const databricksOutput: unknown = (
                  chunk.value as { databricks_output?: unknown }
                ).databricks_output;
                if (
                  databricksOutput &&
                  typeof databricksOutput === 'object' &&
                  'trace' in databricksOutput
                ) {
                  const trace = (databricksOutput as { trace?: unknown }).trace;
                  if (trace && typeof trace === 'object' && 'info' in trace) {
                    const info = (trace as { info?: unknown }).info;
                    if (info && typeof info === 'object' && 'trace_id' in info) {
                      const traceId = (info as { trace_id?: unknown }).trace_id;
                      if (typeof traceId === 'string') {
                        // Normalize trace_id at root level for easier access
                        responseBody.trace_id = traceId;
                        // Store full databricks_output structure for complete trace data
                        responseBody.databricks_output = databricksOutput;
                        console.log('[ResponsesAgent] ✅ Extracted trace_id from response.output_item.done:', traceId);
                      }
                    }
                  }
                }
              }

              const parts = convertResponsesAgentChunkToMessagePart(
                chunk.value,
              );

              allParts.push(...parts);
              /**
               * Check if the last chunk was a tool result without a tool call
               * This is a special case for MCP approval requests where the tool result
               * is sent in a separate call after the tool call was approved/denied.
               */
              if (parts.length === 0) {
                return;
              }
              const part = parts[0];
              if (part.type === 'tool-result') {
                // First check if the tool call is in the current stream parts
                const matchingToolCallInParts = parts.find(
                  (c) =>
                    c.type === 'tool-call' && c.toolCallId === part.toolCallId,
                );
                // Also check if the tool call was emitted earlier in this stream
                const matchingToolCallInStream = allParts.find(
                  (c) =>
                    c.type === 'tool-call' && c.toolCallId === part.toolCallId,
                );
                if (!matchingToolCallInParts && !matchingToolCallInStream) {
                  // Find the tool call in the prompt (previous messages)
                  const toolCallFromPreviousMessages = options.prompt
                    .flatMap((message) => {
                      if (typeof message.content === 'string') return [];
                      return message.content;
                    })
                    .find(
                      (p) =>
                        p.type === 'tool-call' &&
                        p.toolCallId === part.toolCallId,
                    );
                  if (!toolCallFromPreviousMessages) {
                    throw new Error(
                      'No matching tool call found in previous message',
                    );
                  }
                  if (toolCallFromPreviousMessages.type === 'tool-call') {
                    controller.enqueue({
                      ...toolCallFromPreviousMessages,
                      input: JSON.stringify(toolCallFromPreviousMessages.input),
                    });
                  }
                }
              }
              // Dedupe logic for messages sent via response.output_item.done
              // MAS relies on sending text via response.output_item.done ONLY without any delta chunks
              // We have to decide when to display these messages in the UI
              if (
                shouldDedupeOutputItemDone(
                  parts,
                  allParts.slice(0, -parts.length),
                )
              ) {
                return;
              }
              for (const part of parts) {
                controller.enqueue(part);
              }
            },

            flush(controller) {
              controller.enqueue({
                type: 'finish',
                finishReason,
                usage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0,
                },
              });
            },
          }),
        )
        .pipeThrough(getDatabricksLanguageModelTransformStream()),
      request: { body: networkArgs.body },
      response: {
        headers: responseHeaders,
        body: responseBody, // Include mutable responseBody with trace_id
      },
    };
  }

  private async getArgs({
    config,
    options,
    stream,
    modelId,
  }: {
    options: LanguageModelV2CallOptions;
    config: DatabricksLanguageModelConfig;
    stream: boolean;
    modelId: string;
  }) {
    const { input } = await convertToResponsesInput({
      prompt: options.prompt,
      systemMessageMode: 'system',
    });

    // Extract databricks_options from providerOptions
    const databricksOptions =
      options.providerOptions?.databricks?.databricksOptions;

    console.log('[DEBUG] providerOptions:', JSON.stringify(options.providerOptions));
    console.log('[DEBUG] databricksOptions extracted:', databricksOptions);

    const body: Record<string, unknown> = {
      model: modelId,
      input,
      stream,
    };

    // Add databricks_options if provided
    if (databricksOptions) {
      body.databricks_options = databricksOptions;
      console.log('[DEBUG] Added databricks_options to request body');
    }

    return {
      url: config.url({
        path: '/responses',
      }),
      headers: combineHeaders(config.headers(), options.headers),
      body,
      fetch: config.fetch,
    };
  }
}

function shouldDedupeOutputItemDone(
  incomingParts: LanguageModelV2StreamPart[],
  previousParts: LanguageModelV2StreamPart[],
): boolean {
  // Determine if the incoming parts contain a text-delta that is a response.output_item.done
  const doneTextDelta = incomingParts.find(
    (p) =>
      p.type === 'text-delta' &&
      p.providerMetadata?.databricks?.itemType === 'response.output_item.done',
  );

  // If the incoming parts do not contain a text-delta that is a response.output_item.done, return false
  if (
    !doneTextDelta ||
    doneTextDelta.type !== 'text-delta' ||
    !doneTextDelta.id
  ) {
    return false;
  }

  /**
   * To determine if the text in response.output_item.done is a duplicate, we need to reconstruct the text from the
   * previous consecutive text-deltas and check if the .done text is already present in what we've streamed.
   *
   * The caveat is that the response.output_item.done text uses GFM footnote syntax, where as the streamed content
   * uses response.output_text.delta and response.output_text.annotation.added events. So we reconstruct all the
   * delta text and check if the .done text is contained in it (meaning we've already streamed it).
   */
  // 1. Reconstruct the last contiguous text block from previous text-deltas
  // We iterate backwards to get the most recent text block
  let reconstructedText = '';
  for (let i = previousParts.length - 1; i >= 0; i--) {
    const part = previousParts[i];
    if (part.type === 'text-delta') {
      reconstructedText = part.delta + reconstructedText;
    } else {
      // We've hit a non-text-delta part, stop here
      break;
    }
  }

  // 2. Check if the reconstructed delta text is present in the .done text
  // The .done text may include footnote syntax like [^ref] that wasn't in the deltas
  // If the .done text contains all the delta text, we should dedupe it
  if (reconstructedText.length === 0) {
    return false;
  }

  return doneTextDelta.delta.includes(reconstructedText);
}
