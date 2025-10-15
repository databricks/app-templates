import { randomUUID } from 'node:crypto';
import type {
  LanguageModelV2Content,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider';
import type { z } from 'zod/v4';
import type {
  responsesAgentChunkSchema,
  responsesAgentResponseSchema,
} from './responses-agent-schema';
import { DATABRICKS_TOOL_CALL_ID } from '../databricks-tool-calling';

export const convertResponsesAgentChunkToMessagePart = (
  chunk: z.infer<typeof responsesAgentChunkSchema>,
): LanguageModelV2StreamPart[] => {
  const parts: LanguageModelV2StreamPart[] = [];

  switch (chunk.type) {
    case 'response.output_text.delta':
      parts.push({
        type: 'text-delta',
        id: chunk.item_id,
        delta: chunk.delta,
        providerMetadata: {
          databricks: {
            itemId: chunk.item_id,
          },
        },
      });
      break;

    case 'response.reasoning_summary_text.delta':
      parts.push({
        type: 'reasoning-delta',
        id: chunk.item_id,
        delta: chunk.delta,
        providerMetadata: {
          databricks: {
            itemId: chunk.item_id,
          },
        },
      });
      break;

    case 'response.output_item.done':
      if (chunk.item.type === 'message') {
        parts.push(
          {
            type: 'text-start',
            id: chunk.item.id,
          },
          {
            type: 'text-delta',
            id: chunk.item.id,
            delta: chunk.item.content[0].text,
            providerMetadata: {
              databricks: {
                itemId: chunk.item.id,
              },
            },
          },
          {
            type: 'text-end',
            id: chunk.item.id,
          },
        );
      } else if (chunk.item.type === 'function_call') {
        parts.push({
          type: 'tool-call',
          toolCallId: chunk.item.call_id,
          toolName: DATABRICKS_TOOL_CALL_ID,
          input: chunk.item.arguments,
          providerMetadata: {
            databricks: {
              toolName: chunk.item.name,
              itemId: chunk.item.id,
            },
          },
        });
      } else if (chunk.item.type === 'function_call_output') {
        parts.push({
          type: 'tool-result',
          toolCallId: chunk.item.call_id,
          result: chunk.item.output,
          toolName: DATABRICKS_TOOL_CALL_ID,
        });
      } else if (chunk.item.type === 'reasoning') {
        parts.push(
          {
            type: 'reasoning-start',
            id: chunk.item.id,
          },
          {
            type: 'reasoning-delta',
            id: chunk.item.id,
            delta: chunk.item.summary[0].text,
            providerMetadata: {
              databricks: {
                itemId: chunk.item.id,
              },
            },
          },
          {
            type: 'reasoning-end',
            id: chunk.item.id,
          },
        );
      } else {
        const _exhaustiveCheck: never = chunk.item;
      }
      break;

    case 'response.output_text.annotation.added':
      parts.push({
        type: 'source',
        url: chunk.annotation.url,
        title: chunk.annotation.title,
        id: randomUUID(),
        sourceType: 'url',
      });
      break;

    case 'error':
      parts.push({
        type: 'error',
        error: chunk,
      });
      break;

    default: {
      const _exhaustiveCheck: never = chunk;
      break;
    }
  }

  return parts;
};

export const convertResponsesAgentResponseToMessagePart = (
  response: z.infer<typeof responsesAgentResponseSchema>,
): LanguageModelV2Content[] => {
  const parts: LanguageModelV2Content[] = [];

  for (const output of response.output) {
    switch (output.type) {
      case 'message': {
        for (const content of output.content) {
          if (content.type === 'output_text') {
            parts.push({
              type: 'text',
              text: content.text,
              providerMetadata: {
                databricks: {
                  itemId: output.id,
                },
              },
            });
          }
        }
        break;
      }

      case 'function_call':
        parts.push({
          type: 'tool-call',
          toolCallId: output.call_id,
          toolName: output.name,
          input: output.arguments,
          providerMetadata: {
            databricks: {
              itemId: output.id,
            },
          },
        });
        break;

      case 'reasoning':
        for (const summary of output.summary) {
          if (summary.type === 'summary_text') {
            parts.push({
              type: 'reasoning',
              text: summary.text,
              providerMetadata: {
                databricks: {
                  itemId: output.id,
                },
              },
            });
          }
        }
        break;

      case 'function_call_output':
        parts.push({
          type: 'tool-result',
          result: output.output,
          toolCallId: output.call_id,
          toolName: DATABRICKS_TOOL_CALL_ID,
        });
        break;

      default: {
        const _exhaustiveCheck: never = output;
        break;
      }
    }
  }

  return parts;
};
