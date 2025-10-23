import type {
  LanguageModelV2Content,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider';
import { DATABRICKS_TOOL_CALL_ID } from '../databricks-tool-calling';
import type {
  chatAgentChunkSchema,
  chatAgentResponseSchema,
} from './chat-agent-schema';
import type { z } from 'zod/v4';

export const convertChatAgentChunkToMessagePart = (
  chunk: z.infer<typeof chatAgentChunkSchema>,
): LanguageModelV2StreamPart[] => {
  const parts = [] as LanguageModelV2StreamPart[];
  if (chunk.delta.role === 'assistant') {
    if (chunk.delta.content) {
      parts.push({
        type: 'text-delta',
        id: chunk.delta.id,
        delta: chunk.delta.content,
      });
    }
    chunk.delta.tool_calls?.forEach((toolCall) => {
      parts.push({
        type: 'tool-call',
        toolCallId: toolCall.id,
        input: toolCall.function.arguments,
        toolName: toolCall.function.name,
      });
    });
  } else if (chunk.delta.role === 'tool') {
    parts.push({
      type: 'tool-result',
      toolCallId: chunk.delta.tool_call_id,
      result: chunk.delta.content,
      toolName: DATABRICKS_TOOL_CALL_ID,
    });
  }
  return parts;
};

export const convertChatAgentResponseToMessagePart = (
  response: z.infer<typeof chatAgentResponseSchema>,
): LanguageModelV2Content[] => {
  const parts: LanguageModelV2Content[] = [];
  for (const message of response.messages) {
    if (message.role === 'assistant') {
      parts.push({
        type: 'text',
        text: message.content,
      });
      for (const part of message.tool_calls ?? []) {
        parts.push({
          type: 'tool-call',
          toolCallId: part.id,
          input: part.function.arguments,
          toolName: part.function.name,
        });
      }
    } else if (message.role === 'tool') {
      parts.push({
        type: 'tool-result',
        toolCallId: message.tool_call_id,
        result: message.content,
        toolName: DATABRICKS_TOOL_CALL_ID,
      });
    }
  }
  return parts;
};
