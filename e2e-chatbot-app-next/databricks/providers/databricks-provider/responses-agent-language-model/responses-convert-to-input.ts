import {
  UnsupportedFunctionalityError,
  type LanguageModelV2CallWarning,
  type LanguageModelV2Prompt,
  type LanguageModelV2ToolResultPart,
} from '@ai-sdk/provider';
import { parseProviderOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';
import type { ResponsesInput } from './responses-api-types';

export async function convertToResponsesInput({
  prompt,
  systemMessageMode,
}: {
  prompt: LanguageModelV2Prompt;
  systemMessageMode: 'system' | 'developer' | 'remove';
}): Promise<{
  input: ResponsesInput;
  warnings: Array<LanguageModelV2CallWarning>;
}> {
  const input: ResponsesInput = [];
  const warnings: Array<LanguageModelV2CallWarning> = [];

  for (const { role, content } of prompt) {
    switch (role) {
      case 'system': {
        switch (systemMessageMode) {
          case 'system':
            input.push({ role: 'system', content });
            break;

          case 'developer':
            input.push({ role: 'developer', content });
            break;

          case 'remove':
            warnings.push({
              type: 'other',
              message: 'system messages are removed for this model',
            });
            break;

          default: {
            const _exhaustiveCheck: never = systemMessageMode;
            throw new Error(
              `Unsupported system message mode: ${_exhaustiveCheck}`,
            );
          }
        }
        break;
      }

      case 'user':
        input.push({
          role: 'user',
          content: content.map((part) => {
            switch (part.type) {
              case 'text':
                return { type: 'input_text', text: part.text };
              default:
                throw new UnsupportedFunctionalityError({
                  functionality: `part ${JSON.stringify(part)}`,
                });
            }
          }),
        });
        break;

      case 'assistant':
        for (const part of content) {
          switch (part.type) {
            case 'text': {
              input.push({
                role: 'assistant',
                content: [{ type: 'output_text', text: part.text }],
                id:
                  (part.providerOptions?.databricks?.itemId as string) ??
                  undefined,
              });
              break;
            }
            case 'tool-call': {
              input.push({
                type: 'function_call',
                call_id: part.toolCallId,
                name: part.toolName,
                arguments: JSON.stringify(part.input),
                id:
                  (part.providerOptions?.databricks?.itemId as string) ??
                  undefined,
              });
              break;
            }

            case 'tool-result': {
              input.push({
                type: 'function_call_output',
                call_id: part.toolCallId,
                output: convertToolResultOutputToString(part.output),
              });
              break;
            }

            case 'reasoning': {
              const providerOptions = await parseProviderOptions({
                provider: 'databricks',
                providerOptions: part.providerOptions,
                schema: ResponsesReasoningProviderOptionsSchema,
              });
              const reasoningId = providerOptions?.itemId;
              if (!reasoningId) break;
              input.push({
                type: 'reasoning',
                summary: [{ type: 'summary_text', text: part.text }],
                id: reasoningId,
              });
              break;
            }
          }
        }
        break;

      case 'tool':
        for (const part of content) {
          input.push({
            type: 'function_call_output',
            call_id: part.toolCallId,
            output: convertToolResultOutputToString(part.output),
          });
        }
        break;

      default: {
        const _exhaustiveCheck: never = role;
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
      }
    }
  }

  return { input, warnings };
}

const ResponsesReasoningProviderOptionsSchema = z.object({
  itemId: z.string().nullish(),
});

export type ResponsesReasoningProviderOptions = z.infer<
  typeof ResponsesReasoningProviderOptionsSchema
>;

const convertToolResultOutputToString = (
  output: LanguageModelV2ToolResultPart['output'],
): string => {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'content':
    case 'json':
    case 'error-json':
    default:
      return JSON.stringify(output.value);
  }
};
