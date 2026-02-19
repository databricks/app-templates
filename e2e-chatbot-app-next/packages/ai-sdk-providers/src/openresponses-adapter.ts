/**
 * OpenResponses format adapter for Databricks agent apps
 *
 * This module provides streaming format conversion from OpenResponses format
 * (used by declarative agent apps) to Databricks Responses API format.
 */

import {
  openResponsesChunkSchema,
  type OpenResponsesChunk,
} from './openresponses-schema';
import {
  isOpenResponsesFormat,
} from './openresponses-convert';

/**
 * Convert OpenResponses format events to Databricks Responses API format
 * This allows the Databricks AI SDK provider to understand OpenResponses streams
 */
function convertOpenResponsesToDatabricksFormat(
  chunk: OpenResponsesChunk,
): Record<string, unknown> {
  switch (chunk.type) {
    case 'response.output_text.delta':
      // Convert to Databricks text delta format
      return {
        type: 'response.output_text.delta',
        delta: chunk.delta,
      };

    case 'response.output_item.done':
      // Convert to Databricks completion format
      return {
        type: 'responses.completed',
        response: {
          role: chunk.item.role,
          content: chunk.item.content,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
          incomplete_details: null,
        },
      };

    case 'response.error':
      // Pass through error format
      return {
        type: 'error',
        error: {
          message: chunk.error.message,
          type: chunk.error.type || 'unknown_error',
        },
      };

    default:
      // Pass through unknown formats
      return chunk as Record<string, unknown>;
  }
}

/**
 * Wrap fetch to intercept and convert OpenResponses format streams
 *
 * This function wraps the standard fetch API to detect OpenResponses format
 * SSE streams and convert them to Databricks Responses API format on-the-fly.
 */
export function createOpenResponsesAwareFetch(
  baseFetch: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    console.log('[OpenResponses Adapter] Fetch called for:', input.toString());
    const response = await baseFetch(input, init);

    // Only process SSE streams
    const contentType = response.headers.get('content-type') || '';
    console.log('[OpenResponses Adapter] Response content-type:', contentType);
    const isSSE =
      contentType.includes('text/event-stream') ||
      contentType.includes('application/x-ndjson');

    if (!isSSE || !response.body) {
      console.log('[OpenResponses Adapter] Not SSE or no body, passing through');
      return response;
    }

    console.log('[OpenResponses Adapter] Processing SSE stream');

    // Create a transforming stream that converts OpenResponses to Databricks format
    const originalBody = response.body;
    const reader = originalBody.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let detectedOpenResponses = false;

    const transformingStream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();

        if (done) {
          // Flush any remaining buffer
          if (buffer.trim()) {
            controller.enqueue(new TextEncoder().encode(buffer));
          }
          controller.close();
          return;
        }

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data:')) {
            // Pass through non-data lines (comments, etc.)
            controller.enqueue(new TextEncoder().encode(line + '\n'));
            continue;
          }

          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            controller.enqueue(new TextEncoder().encode(line + '\n'));
            continue;
          }

          try {
            const parsed = JSON.parse(data);

            // Detect if this is OpenResponses format
            if (!detectedOpenResponses && isOpenResponsesFormat(parsed)) {
              detectedOpenResponses = true;
              console.log('[OpenResponses Adapter] Detected OpenResponses format, converting to Databricks format');
            }

            if (detectedOpenResponses) {
              // Validate with schema
              const validated = openResponsesChunkSchema.safeParse(parsed);
              if (validated.success) {
                // Convert to Databricks format
                const converted = convertOpenResponsesToDatabricksFormat(validated.data);
                const newLine = `data: ${JSON.stringify(converted)}\n`;
                controller.enqueue(new TextEncoder().encode(newLine));
              } else {
                // Pass through if validation fails
                controller.enqueue(new TextEncoder().encode(line + '\n'));
              }
            } else {
              // Not OpenResponses format, pass through
              controller.enqueue(new TextEncoder().encode(line + '\n'));
            }
          } catch (e) {
            // JSON parse error, pass through
            controller.enqueue(new TextEncoder().encode(line + '\n'));
          }
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    // Return response with transformed body
    return new Response(transformingStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
