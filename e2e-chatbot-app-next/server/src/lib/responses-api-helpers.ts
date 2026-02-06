/**
 * TypeScript helpers for converting LangChain messages to Responses API format
 * Ported from MLflow: ~/mlflow/mlflow/types/responses.py
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Responses API Types
 * Based on https://mlflow.org/docs/latest/genai/serving/responses-agent/
 */

export interface TextOutputItem {
  type: 'message';
  id: string;
  role: 'assistant';
  content: Array<{
    type: 'output_text';
    text: string;
    annotations?: any[];
  }>;
}

export interface FunctionCallItem {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface FunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export interface ReasoningItem {
  type: 'reasoning';
  id: string;
  summary: Array<{
    type: 'summary_text';
    text: string;
  }>;
}

export type OutputItem = TextOutputItem | FunctionCallItem | FunctionCallOutputItem | ReasoningItem;

export interface ResponsesAgentStreamEvent {
  type: string;
  [key: string]: any;
}

export interface TextDeltaEvent extends ResponsesAgentStreamEvent {
  type: 'response.output_text.delta';
  item_id: string;
  delta: string;
}

export interface OutputItemDoneEvent extends ResponsesAgentStreamEvent {
  type: 'response.output_item.done';
  item: OutputItem;
}

export interface ResponseCompletedEvent extends ResponsesAgentStreamEvent {
  type: 'response.completed';
}

export interface ErrorEvent extends ResponsesAgentStreamEvent {
  type: 'error';
  error: {
    message: string;
    code?: string;
  };
}

/**
 * Helper method to create a text output item
 * @param text The text content
 * @param id The item ID
 * @param annotations Optional annotations
 */
export function createTextOutputItem(
  text: string,
  id: string,
  annotations?: any[]
): TextOutputItem {
  const contentItem: any = {
    text,
    type: 'output_text',
  };

  if (annotations) {
    contentItem.annotations = annotations;
  }

  return {
    id,
    content: [contentItem],
    role: 'assistant',
    type: 'message',
  };
}

/**
 * Helper method to create a function call item
 * @param id The item ID
 * @param callId The call ID
 * @param name The function name
 * @param args The function arguments (JSON string)
 */
export function createFunctionCallItem(
  id: string,
  callId: string,
  name: string,
  args: string
): FunctionCallItem {
  return {
    type: 'function_call',
    id,
    call_id: callId,
    name,
    arguments: args,
  };
}

/**
 * Helper method to create a function call output item
 * @param callId The call ID
 * @param output The function output
 */
export function createFunctionCallOutputItem(
  callId: string,
  output: string
): FunctionCallOutputItem {
  return {
    type: 'function_call_output',
    call_id: callId,
    output,
  };
}

/**
 * Helper method to create a reasoning item
 * @param id The item ID
 * @param reasoningText The reasoning text
 */
export function createReasoningItem(
  id: string,
  reasoningText: string
): ReasoningItem {
  return {
    type: 'reasoning',
    summary: [
      {
        type: 'summary_text',
        text: reasoningText,
      },
    ],
    id,
  };
}

/**
 * Helper method to create a text delta event
 * @param delta The text delta
 * @param itemId The item ID
 */
export function createTextDelta(delta: string, itemId: string): TextDeltaEvent {
  return {
    type: 'response.output_text.delta',
    item_id: itemId,
    delta,
  };
}

/**
 * Convert LangChain StreamEvent to Responses API events
 * Based on MLflow's _langchain_message_stream_to_responses_stream
 */
export async function* langchainEventsToResponsesStream(
  eventStream: AsyncIterable<any>
): AsyncGenerator<ResponsesAgentStreamEvent> {
  const textItemIds = new Map<string, string>(); // Map message IDs to item IDs
  const toolCallToItemId = new Map<string, string>(); // Map tool call IDs to item IDs

  try {
    for await (const event of eventStream) {
      // Handle tool call start
      if (event.event === 'on_tool_start') {
        const toolName = event.name;
        const toolInput = event.data?.input;
        const toolCallId = event.run_id;
        const itemId = uuidv4();

        toolCallToItemId.set(toolCallId, itemId);

        // Create function call item
        const functionCallItem = createFunctionCallItem(
          itemId,
          toolCallId,
          toolName,
          JSON.stringify(toolInput)
        );

        yield {
          type: 'response.output_item.done',
          item: functionCallItem,
        };
      }

      // Handle tool call result
      if (event.event === 'on_tool_end') {
        const toolCallId = event.run_id;
        const toolOutput = event.data?.output;

        if (toolCallId) {
          const functionCallOutputItem = createFunctionCallOutputItem(
            toolCallId,
            typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput)
          );

          yield {
            type: 'response.output_item.done',
            item: functionCallOutputItem,
          };
        }
      }

      // Handle streaming text from the model
      if (event.event === 'on_chat_model_stream') {
        const content = event.data?.chunk?.content;
        if (typeof content === 'string' && content) {
          // Use a consistent item ID for all text in this message
          const messageId = event.run_id;
          let itemId = textItemIds.get(messageId);

          if (!itemId) {
            itemId = uuidv4();
            textItemIds.set(messageId, itemId);
          }

          // Emit text delta
          yield createTextDelta(content, itemId);
        }
      }

      // Handle final agent output
      if (event.event === 'on_chain_end' && event.name === 'AgentExecutor') {
        const output = event.data?.output?.output;
        if (typeof output === 'string' && output) {
          // Check if we already streamed this text
          const messageId = event.run_id;
          const itemId = textItemIds.get(messageId) || uuidv4();

          // Emit the complete text item for aggregation/logging
          const textOutputItem = createTextOutputItem(output, itemId);
          yield {
            type: 'response.output_item.done',
            item: textOutputItem,
          };
        }
      }
    }

    // Emit completion event
    yield {
      type: 'response.completed',
    };
  } catch (error) {
    // Emit error event
    yield {
      type: 'error',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'stream_error',
      },
    };
  }
}
