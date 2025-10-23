import type { LanguageModelV2Prompt } from '@ai-sdk/provider';
import type { z } from 'zod/v4';
import type { chatAgentResponseSchema } from './chat-agent-schema';

export const convertLanguageModelV2PromptToChatAgentResponse = (
  prompt: LanguageModelV2Prompt,
): z.infer<typeof chatAgentResponseSchema>['messages'] => {
  const messages: z.infer<typeof chatAgentResponseSchema>['messages'] = [];

  let messageIndex = 0;

  for (const msg of prompt) {
    if (msg.role === 'system') {
      // System messages are prompt-only; they don't exist in ChatAgent responses.
      continue;
    }

    if (msg.role === 'user') {
      const text = (msg.content ?? [])
        .filter(
          (part): part is Extract<typeof part, { type: 'text' }> =>
            part.type === 'text',
        )
        .map((part) => part.text)
        .join('\n');

      messages.push({
        role: 'user',
        content: text,
        id: `user-${messageIndex++}`,
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const textContent = (msg.content ?? [])
        .filter((part) => part.type === 'text' || part.type === 'reasoning')
        .map((part: any) => (part.type === 'text' ? part.text : part.text))
        .join('\n');

      const toolCalls = (msg.content ?? [])
        .filter(
          (part): part is Extract<typeof part, { type: 'tool-call' }> =>
            part.type === 'tool-call',
        )
        .map((call) => ({
          type: 'function' as const,
          id: call.toolCallId,
          function: {
            name: call.toolName,
            arguments:
              typeof (call as any).input === 'string'
                ? ((call as any).input as string)
                : JSON.stringify((call as any).input ?? {}),
          },
        }));

      messages.push({
        role: 'assistant',
        content: textContent,
        id: `assistant-${messageIndex++}`,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      // Convert any tool results embedded in the assistant message into separate tool messages.
      for (const part of msg.content ?? []) {
        if (part.type === 'tool-result') {
          const content = (() => {
            switch (part.output.type) {
              case 'text':
                return part.output.value;
              case 'json':
                return JSON.stringify(part.output.value);
              case 'error-text':
                return part.output.value;
              case 'error-json':
                return JSON.stringify(part.output.value);
              case 'content':
                return part.output.value
                  .map((p) => (p.type === 'text' ? p.text : ''))
                  .filter(Boolean)
                  .join('\n');
              default:
                return '';
            }
          })();

          messages.push({
            role: 'tool',
            name: part.toolName,
            content,
            tool_call_id: part.toolCallId,
            id: `tool-${messageIndex++}`,
          });
        }
      }
      continue;
    }

    if (msg.role === 'tool') {
      for (const part of msg.content ?? []) {
        if (part.type !== 'tool-result') continue;

        const content = (() => {
          switch (part.output.type) {
            case 'text':
              return part.output.value;
            case 'json':
              return JSON.stringify(part.output.value);
            case 'error-text':
              return part.output.value;
            case 'error-json':
              return JSON.stringify(part.output.value);
            case 'content':
              return part.output.value
                .map((p) => (p.type === 'text' ? p.text : ''))
                .filter(Boolean)
                .join('\n');
            default:
              return '';
          }
        })();

        messages.push({
          role: 'tool',
          name: part.toolName,
          content,
          tool_call_id: part.toolCallId,
          id: `tool-${messageIndex++}`,
        });
      }
      continue;
    }
  }

  return messages;
};
