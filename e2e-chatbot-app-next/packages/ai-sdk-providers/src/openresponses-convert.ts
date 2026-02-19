import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type {
  OpenResponsesChunk,
  OpenResponsesTextDelta,
  OpenResponsesItemDone,
  OpenResponsesError,
} from './openresponses-schema';

/**
 * Convert OpenResponses events to AI SDK stream parts
 */
export function convertOpenResponsesChunkToStreamPart(
  chunk: OpenResponsesChunk,
  messageId: string,
): LanguageModelV3StreamPart[] {
  const parts: LanguageModelV3StreamPart[] = [];

  switch (chunk.type) {
    case 'response.output_text.delta': {
      const textDelta = chunk as OpenResponsesTextDelta;
      parts.push({
        type: 'text-delta',
        textDelta: textDelta.delta,
      });
      break;
    }

    case 'response.output_item.done': {
      const itemDone = chunk as OpenResponsesItemDone;
      parts.push({
        type: 'finish',
        finishReason: 'stop',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
        },
        providerMetadata: {
          databricks: {
            format: 'openresponses',
            fullContent: itemDone.item.content,
          },
        },
      });
      break;
    }

    case 'response.error': {
      const errorChunk = chunk as OpenResponsesError;
      parts.push({
        type: 'error',
        error: errorChunk.error.message,
      });
      break;
    }
  }

  return parts;
}

/**
 * Detect if chunk contains OpenResponses format events
 */
export function isOpenResponsesFormat(chunk: unknown): boolean {
  if (typeof chunk !== 'object' || chunk === null) return false;

  const type = (chunk as { type?: string }).type;
  return (
    type === 'response.output_text.delta' ||
    type === 'response.output_item.done' ||
    type === 'response.error'
  );
}
