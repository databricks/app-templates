import type { JSONSchema7 } from '@ai-sdk/provider';

export type ResponsesInput = Array<ResponsesInputItem>;

export type ResponsesInputItem =
  | ResponsesSystemMessage
  | ResponsesUserMessage
  | ResponsesAssistantMessage
  | ResponsesFunctionCall
  | ResponsesFunctionCallOutput
  | ResponsesReasoning;

export type ResponsesSystemMessage = {
  role: 'system' | 'developer';
  content: string;
};

export type ResponsesUserMessage = {
  role: 'user';
  content: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string }
    | { type: 'input_image'; file_id: string }
    | { type: 'input_file'; file_url: string }
    | { type: 'input_file'; filename: string; file_data: string }
    | { type: 'input_file'; file_id: string }
  >;
};

export type ResponsesAssistantMessage = {
  role: 'assistant';
  content: Array<{ type: 'output_text'; text: string }>;
  id?: string;
};

export type ResponsesFunctionCall = {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
};

export type ResponsesFunctionCallOutput = {
  type: 'function_call_output';
  call_id: string;
  output: string;
};

export type ResponsesTool = {
  type: 'function';
  name: string;
  description: string | undefined;
  parameters: JSONSchema7;
  strict: boolean | undefined;
};

export type ResponsesReasoning = {
  type: 'reasoning';
  id: string;
  encrypted_content?: string | null;
  summary: Array<{
    type: 'summary_text';
    text: string;
  }>;
};
