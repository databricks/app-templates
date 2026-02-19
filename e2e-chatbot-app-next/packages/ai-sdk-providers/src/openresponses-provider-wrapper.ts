/**
 * Provider wrapper that adds OpenResponses format support
 *
 * This wraps the Databricks provider's responses() method to intercept
 * and convert OpenResponses format streams before the provider processes them.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { isOpenResponsesFormat } from './openresponses-convert';

/**
 * Wrap a Databricks provider to add OpenResponses format support
 */
export function wrapProviderWithOpenResponsesSupport(provider: any): any {
  const originalResponses = provider.responses.bind(provider);

  return {
    ...provider,
    responses(modelId: string): LanguageModelV3 {
      const model = originalResponses(modelId);

      // Wrap the doStream method to handle OpenResponses format
      const originalDoStream = model.doStream.bind(model);

      model.doStream = async (options: any) => {
        console.log('[OpenResponses Wrapper] doStream called for model:', modelId);

        try {
          const result = await originalDoStream(options);
          console.log('[OpenResponses Wrapper] Got stream result');

          // The result contains a ReadableStream - we need to transform it
          const originalStream = result.stream;

          // Create a transforming stream that logs what we receive
          const loggingStream = originalStream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                console.log('[OpenResponses Wrapper] Received chunk:', JSON.stringify(chunk));
                controller.enqueue(chunk);
              }
            })
          );

          return {
            ...result,
            stream: loggingStream,
          };
        } catch (error) {
          console.error('[OpenResponses Wrapper] Error in doStream:', error);
          throw error;
        }
      };

      return model;
    },
  };
}
