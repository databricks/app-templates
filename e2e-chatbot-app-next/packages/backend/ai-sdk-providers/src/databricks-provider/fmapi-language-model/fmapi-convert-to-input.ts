import type {
  LanguageModelV2Message,
  LanguageModelV2ToolResultPart,
} from '@ai-sdk/provider';
import type { FmapiMessage } from './fmapi-schema';
import { serializeToolCall, serializeToolResult } from './fmapi-tags';

export const convertPromptToFmapiMessages = (
  prompt: LanguageModelV2Message[],
): { messages: Array<FmapiMessage> } => {
  const messages: Array<FmapiMessage> = prompt.map((message) => {
    const role = message.role === 'system' ? 'user' : message.role;

    const contentItems: Array<
      Exclude<NonNullable<FmapiMessage['content']>, string>[number]
    > = [];

    if (message.role === 'system') {
      contentItems.push({ type: 'text', text: message.content as string });
    } else if (message.role === 'user') {
      for (const part of message.content) {
        if (part.type === 'text') {
          contentItems.push({ type: 'text', text: part.text });
        } else if (part.type === 'file') {
          const file = part;
          if (file.mediaType.startsWith('image/')) {
            const url = toHttpUrlString(file.data);
            if (url) contentItems.push({ type: 'image', image_url: url });
          }
        }
      }
    } else if (message.role === 'assistant') {
      for (const part of message.content) {
        switch (part.type) {
          case 'text':
            contentItems.push({ type: 'text', text: part.text });
            break;
          case 'file': {
            const file = part;
            if (file.mediaType.startsWith('image/')) {
              const url = toHttpUrlString(file.data);
              if (url) contentItems.push({ type: 'image', image_url: url });
            }
            break;
          }
          case 'reasoning': {
            contentItems.push({
              type: 'reasoning',
              summary: [
                {
                  type: 'summary_text',
                  text: part.text,
                },
              ],
            });
            break;
          }
          case 'tool-call': {
            const tagged = serializeToolCall({
              id: part.toolCallId,
              name: part.toolName,
              arguments: part.input,
            });
            contentItems.push({
              type: 'text',
              text: tagged,
            });
            break;
          }
          case 'tool-result': {
            const tagged = serializeToolResult({
              id: part.toolCallId,
              content: convertToolResultOutputToContentValue(part.output),
            });
            contentItems.push({
              type: 'text',
              text: tagged,
            });
            break;
          }
        }
      }
    } else if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type === 'tool-result') {
          const tagged = serializeToolResult({
            id: part.toolCallId,
            content: convertToolResultOutputToContentValue(part.output),
          });
          contentItems.push({
            type: 'text',
            text: tagged,
          });
        }
      }
    }

    const content = contentItems.length === 0 ? '' : contentItems;
    return { role: role as 'assistant' | 'user' | 'tool', content };
  });
  return { messages };
};

const toHttpUrlString = (data: URL | string | Uint8Array): string | null => {
  if (data instanceof URL) return data.toString();
  if (typeof data === 'string') {
    if (data.startsWith('http://') || data.startsWith('https://')) return data;
  }
  return null;
};

const convertToolResultOutputToContentValue = (
  output: LanguageModelV2ToolResultPart['output'],
): unknown => {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return output.value;
    case 'content':
      return output.value;
    default:
      return null;
  }
};
