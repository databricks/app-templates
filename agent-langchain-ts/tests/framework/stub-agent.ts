/**
 * Deterministic stub AgentInterface for framework tests.
 *
 * Echoes user input as "Echo: {input}" — no LLM or network required.
 * Framework tests use this so they are decoupled from user agent code.
 */

import { randomUUID } from "crypto";
import type {
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.js";
import type { AgentInterface, InvokeParams } from "../../src/framework/agent-interface.js";

export class StubAgent implements AgentInterface {
  async invoke(params: InvokeParams): Promise<ResponseOutputItem[]> {
    const text = `Echo: ${params.input}`;
    const message: ResponseOutputMessage = {
      id: `msg_${randomUUID()}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    };
    return [message];
  }

  async *stream(params: InvokeParams): AsyncGenerator<ResponseStreamEvent> {
    const text = `Echo: ${params.input}`;
    const itemId = `msg_${randomUUID()}`;
    let seqNum = 0;

    const msgItem: ResponseOutputMessage = {
      id: itemId,
      type: "message",
      role: "assistant",
      status: "in_progress",
      content: [],
    };

    yield {
      type: "response.output_item.added",
      item: msgItem,
      output_index: 0,
      sequence_number: seqNum++,
    } as unknown as ResponseStreamEvent;

    yield {
      type: "response.output_text.delta",
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: text,
      logprobs: [],
      sequence_number: seqNum++,
    } as unknown as ResponseStreamEvent;

    yield {
      type: "response.output_item.done",
      item: { ...msgItem, status: "completed" },
      output_index: 0,
      sequence_number: seqNum++,
    } as unknown as ResponseStreamEvent;

    yield {
      type: "response.completed",
      sequence_number: seqNum++,
      response: {} as any,
    } as unknown as ResponseStreamEvent;
  }
}
