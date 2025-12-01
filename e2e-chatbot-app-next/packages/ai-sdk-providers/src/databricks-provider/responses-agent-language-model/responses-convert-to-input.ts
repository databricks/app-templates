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

  // Map tool call results to a map by tool call id so we can insert them into the input in the correct order,
  // right after the tool call that produced them.
  const toolCallResultsByToolCallId = prompt
    .filter((p) => p.role === 'tool')
    .flatMap((p) => p.content)
    .reduce(
      (reduction, toolCallResult) => {
        if (toolCallResult.type === 'tool-result') {
          reduction[toolCallResult.toolCallId] = toolCallResult;
        }
        return reduction;
      },
      {} as Record<string, LanguageModelV2ToolResultPart>,
    );

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
          const providerOptions = await parseProviderOptions({
            provider: 'databricks',
            providerOptions: part.providerOptions,
            schema: ProviderOptionsSchema,
          });
          const itemId = providerOptions?.itemId ?? undefined;
          switch (part.type) {
            case 'text': {
              input.push({
                role: 'assistant',
                content: [{ type: 'output_text', text: part.text }],
                id: itemId,
              });
              break;
            }
            case 'tool-call': {
              const toolName = providerOptions?.toolName ?? part.toolName;
              if (providerOptions?.type === 'mcp_approval_request') {
                // Special case for MCP approval request
                const serverLabel = providerOptions?.serverLabel ?? '';
                const argumentsString = JSON.stringify(part.input);
                const id = part.toolCallId;
                input.push({
                  type: 'mcp_approval_request',
                  id: id,
                  name: toolName,
                  arguments: argumentsString,
                  server_label: serverLabel,
                });
                const approvalResponse =
                  toolCallResultsByToolCallId[part.toolCallId];
                if (approvalResponse) {
                  console.log('approvalResponse', approvalResponse);
                  const approvalStatus =
                    approvalResponse.output.type === 'json' &&
                    approvalResponse.output.value &&
                    typeof approvalResponse.output.value === 'object' &&
                    'approvalStatus' in approvalResponse.output.value
                      ? approvalResponse.output.value?.approvalStatus === true
                      : undefined;
                  if (approvalStatus !== undefined) {
                    input.push({
                      type: 'mcp_approval_response',
                      id: approvalResponse.toolCallId,
                      approval_request_id: approvalResponse.toolCallId,
                      approve: approvalStatus,
                    });
                  }
                }
                break;
              }
              input.push({
                type: 'function_call',
                call_id: part.toolCallId,
                name: toolName,
                arguments: JSON.stringify(part.input),
                id: itemId,
              });
              const toolCallResult =
                toolCallResultsByToolCallId[part.toolCallId];
              if (toolCallResult) {
                input.push({
                  type: 'function_call_output',
                  call_id: part.toolCallId,
                  output: convertToolResultOutputToString(
                    toolCallResult.output,
                  ),
                });
              }
              break;
            }

            case 'tool-result': {
              if (providerOptions?.type === 'mcp_approval_response') {
                // if (part.output.type === 'json') {
                //   const foo = part.output.value;
                // }
                // Special case for MCP approval response
                const approvalRequestId =
                  providerOptions?.approvalRequestId ?? part.toolCallId;
                const approve = providerOptions?.approve ?? false;
                const reason = providerOptions?.reason ?? '';
                input.push({
                  type: 'mcp_approval_response',
                  id: approvalRequestId,
                  approval_request_id: approvalRequestId,
                  approve: approve,
                  reason: reason,
                });
                break;
              }
              input.push({
                type: 'function_call_output',
                call_id: part.toolCallId,
                output: convertToolResultOutputToString(part.output),
              });
              break;
            }

            case 'reasoning': {
              if (!itemId) break;
              input.push({
                type: 'reasoning',
                summary: [{ type: 'summary_text', text: part.text }],
                id: itemId,
              });
              break;
            }
          }
        }
        break;

      case 'tool':
        // Tool call results are already inserted into the input in the correct order,
        // right after the tool call that produced them.
        break;

      default: {
        const _exhaustiveCheck: never = role;
        throw new Error(`Unsupported role: ${_exhaustiveCheck}`);
      }
    }
  }

  return { input, warnings };
}

const ProviderOptionsSchema = z.object({
  itemId: z.string().nullish(),
  toolName: z.string().nullish(), // for tool-call
  type: z.enum(['mcp_approval_request', 'mcp_approval_response']).nullish(), // for mcp approval request and response
  serverLabel: z.string().nullish(), // for mcp approval request
  approvalRequestId: z.string().nullish(), // for mcp approval response
  approve: z.boolean().nullish(), // for mcp approval response
  reason: z.string().nullish(), // for mcp approval response
});

export type ProviderOptions = z.infer<typeof ProviderOptionsSchema>;

const convertToolResultOutputToString = (
  output: LanguageModelV2ToolResultPart['output'],
): string => {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    default:
      return JSON.stringify(output.value);
  }
};
