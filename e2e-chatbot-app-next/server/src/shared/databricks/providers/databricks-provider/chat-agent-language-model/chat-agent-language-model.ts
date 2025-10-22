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
  createJsonResponseHandler,
  createJsonErrorResponseHandler,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import type { DatabricksLanguageModelConfig } from '../databricks-language-model';
import {
  chatAgentResponseSchema,
  chatAgentChunkSchema,
} from './chat-agent-schema';
import {
  convertChatAgentChunkToMessagePart,
  convertChatAgentResponseToMessagePart,
} from './chat-agent-convert-to-message-parts';
import { convertLanguageModelV2PromptToChatAgentResponse } from './chat-agent-convert-to-input';
import { getDatabricksLanguageModelTransformStream } from '../stream-transformers/databricks-stream-transformer';

export class DatabricksChatAgentLanguageModel implements LanguageModelV2 {
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
    const networkArgs = this.getArgs({
      config: this.config,
      options,
      stream: false,
      modelId: this.modelId,
    });

    const { value: response } = await postJsonToApi({
      ...networkArgs,
      successfulResponseHandler: createJsonResponseHandler(
        chatAgentResponseSchema,
      ),
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: z.any(), // TODO: Implement error schema
        errorToMessage: (error) => JSON.stringify(error), // TODO: Implement error to message
        isRetryable: () => false,
      }),
    });

    return {
      content: convertChatAgentResponseToMessagePart(response),
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
    const networkArgs = this.getArgs({
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
      successfulResponseHandler:
        createEventSourceResponseHandler(chatAgentChunkSchema),
    });

    let finishReason: LanguageModelV2FinishReason = 'unknown';

    return {
      stream: response
        .pipeThrough(
          new TransformStream<
            ParseResult<z.infer<typeof chatAgentChunkSchema>>,
            LanguageModelV2StreamPart
          >({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
            },

            transform(chunk, controller) {
              console.log(
                '[DatabricksChatAgentLanguageModel] transform',
                chunk,
              );
              if (options.includeRawChunks) {
                controller.enqueue({ type: 'raw', rawValue: chunk.rawValue });
              }

              // // handle failed chunk parsing / validation:
              if (!chunk.success) {
                finishReason = 'error';
                controller.enqueue({ type: 'error', error: chunk.error });
                return;
              }

              const parts = convertChatAgentChunkToMessagePart(chunk.value);
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
      response: { headers: responseHeaders },
    };
  }

  private getArgs({
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
    return {
      body: {
        model: modelId,
        stream,
        messages: convertLanguageModelV2PromptToChatAgentResponse(
          options.prompt,
        ),
      },
      url: config.url({
        path: '/completions',
      }),
      headers: combineHeaders(config.headers(), options.headers),
      fetch: config.fetch,
      abortSignal: options.abortSignal,
    };
  }
}
