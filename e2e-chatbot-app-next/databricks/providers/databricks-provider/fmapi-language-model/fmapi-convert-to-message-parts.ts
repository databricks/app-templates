import type {
  LanguageModelV2Content,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider';
import { DATABRICKS_TOOL_CALL_ID } from '../databricks-tool-calling';
import type {
  FmapiChunk,
  FmapiContentItem,
  FmapiResponse,
} from './fmapi-schema';
import {
  parseTaggedToolCall,
  parseTaggedToolResult,
  tagSplitRegex,
} from './fmapi-tags';

type ToolCallOrResult = Extract<
  LanguageModelV2StreamPart,
  { type: 'tool-call' | 'tool-result' }
>;

export const convertFmapiChunkToMessagePart = (
  chunk: FmapiChunk,
): LanguageModelV2StreamPart[] => {
  const parts: LanguageModelV2StreamPart[] = [];
  const choice = chunk.choices[0];

  if (typeof choice.delta.content === 'string') {
    const extracted = extractPartsFromTextCompletion(choice.delta.content);
    for (const part of extracted) {
      if (part.type === 'text') {
        parts.push({
          type: 'text-delta',
          id: chunk.id,
          delta: part.text,
        });
      } else {
        parts.push(part);
      }
    }
  } else if (Array.isArray(choice.delta.content)) {
    parts.push(...mapContentItemsToStreamParts(choice.delta.content, chunk.id));
  }

  return parts;
};

export const convertFmapiResponseToMessagePart = (
  response: FmapiResponse,
): LanguageModelV2Content[] => {
  const parts: LanguageModelV2Content[] = [];
  const choice = response.choices[0];

  if (typeof choice.message.content === 'string') {
    const extracted = extractToolPartsFromText(choice.message.content);
    if (extracted) {
      for (const part of extracted) parts.push(part);
    } else {
      parts.push({ type: 'text', text: choice.message.content });
    }
  } else {
    parts.push(
      ...mapContentItemsToProviderContent(choice.message.content ?? []),
    );
  }

  return parts;
};

const extractPartsFromTextCompletion = (
  text: string,
): (ToolCallOrResult | { type: 'text'; text: string })[] => {
  const parts = text.split(tagSplitRegex);

  const accumulated: (ToolCallOrResult | { type: 'text'; text: string })[] = [];
  for (const segment of parts.filter((p) => p !== '')) {
    const toolParts = extractToolPartsFromText(segment);
    if (toolParts) {
      accumulated.push(...toolParts);
    } else {
      accumulated.push({ type: 'text', text: segment });
    }
  }
  return accumulated;
};

const extractToolPartsFromText = (text: string): ToolCallOrResult[] | null => {
  const trimmed = text.trim();
  const call = parseTaggedToolCall(trimmed);
  if (call) {
    return [
      {
        type: 'tool-call',
        input:
          typeof call.arguments === 'string'
            ? call.arguments
            : JSON.stringify(call.arguments),
        toolName: call.name,
        toolCallId: call.id,
        providerExecuted: true,
      },
    ];
  }
  const result = parseTaggedToolResult(trimmed);
  if (result) {
    return [
      {
        type: 'tool-result',
        result: result.content,
        toolCallId: result.id,
        toolName: DATABRICKS_TOOL_CALL_ID,
      },
    ];
  }
  return null;
};

const mapContentItemsToStreamParts = (
  items: FmapiContentItem[],
  id: string,
): LanguageModelV2StreamPart[] => {
  const parts: LanguageModelV2StreamPart[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'text':
        parts.push({ type: 'text-delta', id, delta: item.text });
        break;
      case 'image':
        // Images are currently not supported in stream parts
        break;
      case 'reasoning': {
        for (const summary of item.summary.filter(
          (s) => s.type === 'summary_text',
        )) {
          parts.push({ type: 'reasoning-delta', id, delta: summary.text });
        }
        break;
      }
    }
  }
  return parts;
};

const mapContentItemsToProviderContent = (
  items: FmapiContentItem[],
): LanguageModelV2Content[] => {
  const parts: LanguageModelV2Content[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'text':
        parts.push({ type: 'text', text: item.text });
        break;
      case 'image':
        // Images are currently not supported in content parts
        break;
      case 'reasoning': {
        for (const summary of item.summary.filter(
          (s) => s.type === 'summary_text',
        )) {
          parts.push({ type: 'reasoning', text: summary.text });
        }
        break;
      }
    }
  }
  return parts;
};
