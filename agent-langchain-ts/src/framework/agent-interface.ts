import type {
  ResponseOutputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";

export interface InvokeParams {
  input: string;
  chat_history?: Array<{ role: string; content: string }>;
}

/**
 * Interface your agent must implement.
 *
 * The framework calls invoke() and stream() with a simplified request object.
 * Return Responses API-native output types so the framework can serialize them
 * correctly over HTTP.
 *
 * You are responsible for translating your SDK's output (LangChain, OpenAI SDK,
 * etc.) into these types. If you switch SDKs, update the implementations here.
 */
export interface AgentInterface {
  /**
   * Handle a non-streaming request. Return the output items to include in the response.
   */
  invoke(params: InvokeParams): Promise<ResponseOutputItem[]>;

  /**
   * Handle a streaming request. Yield Responses API SSE events.
   *
   * Must yield events in this order:
   *   response.output_item.added → response.output_text.delta (×N) → response.output_item.done
   * followed by response.completed at the end.
   *
   * If you switch SDKs, re-implement this method to yield ResponseStreamEvent
   * from your SDK's streaming output.
   */
  stream(params: InvokeParams): AsyncGenerator<ResponseStreamEvent>;
}
