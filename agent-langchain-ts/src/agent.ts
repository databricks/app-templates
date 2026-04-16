/**
 * LangChain agent implementation using standard LangGraph APIs.
 *
 * Uses createReactAgent from @langchain/langgraph/prebuilt for:
 * - Automatic tool calling and execution
 * - Built-in agentic loop
 * - Streaming support
 * - Standard LangChain message format
 */

import { ChatDatabricks, DatabricksMCPServer } from "@databricks/langchainjs";
import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { randomUUID } from "crypto";
import type {
  ResponseFunctionToolCall,
  ResponseOutputItem,
  ResponseOutputItemAddedEvent,
  ResponseOutputItemDoneEvent,
  ResponseOutputMessage,
  ResponseStreamEvent,
  ResponseTextDeltaEvent,
} from "openai/resources/responses/responses.js";
import type { AgentInterface, InvokeParams } from "./framework/agent-interface.js";
import { getAllTools } from "./tools.js";

/**
 * Agent configuration
 */
export interface AgentConfig {
  /**
   * Databricks model serving endpoint name or model ID
   * Examples: "databricks-claude-sonnet-4-5", "databricks-gpt-5-2"
   */
  model?: string;

  /**
   * Whether ChatDatabricks calls the upstream model using the Responses API
   * instead of the Chat Completions API. When true, the model response may
   * include richer fields (citations, reasoning tokens) from supported endpoints.
   * Note: the framework always produces Responses API SSE format regardless of
   * this flag — it only affects the upstream model call.
   * Default: false
   */
  useResponsesApi?: boolean;

  /**
   * Temperature for response generation (0.0 - 1.0)
   */
  temperature?: number;

  /**
   * Maximum tokens to generate
   */
  maxTokens?: number;

  /**
   * System prompt for the agent
   */
  systemPrompt?: string;

  /**
   * MCP servers for additional tools
   */
  mcpServers?: DatabricksMCPServer[];

}

/**
 * Default system prompt for the agent
 */
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to various tools`;

/**
 * Convert plain message objects to LangChain BaseMessage objects
 */
function convertToBaseMessages(messages: any[]): BaseMessage[] {
  return messages.map((msg) => {
    if (msg instanceof BaseMessage) {
      return msg;
    }

    const content = msg.content || "";
    switch (msg.role) {
      case "user":
        return new HumanMessage(content);
      case "assistant":
        return { role: "assistant", content } as any;
      case "system":
        return new SystemMessage(content);
      default:
        return new HumanMessage(content);
    }
  });
}

/**
 * Standard LangGraph agent wrapper
 *
 * Wraps createReactAgent and implements AgentInterface so the framework
 * can call invoke() and stream() without knowing LangGraph internals.
 * If you switch to a different SDK, re-implement these two methods.
 */
export class StandardAgent implements AgentInterface {
  private agent: Awaited<ReturnType<typeof createReactAgent>>;
  private systemPrompt: string;

  constructor(agent: Awaited<ReturnType<typeof createReactAgent>>, systemPrompt: string) {
    this.agent = agent;
    this.systemPrompt = systemPrompt;
  }

  /**
   * Handle a non-streaming request.
   * Returns a ResponseOutputMessage wrapping the final assistant reply.
   */
  async invoke(params: InvokeParams): Promise<ResponseOutputItem[]> {
    const { input, chat_history = [] } = params;

    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt),
      ...convertToBaseMessages(chat_history),
      new HumanMessage(input),
    ];

    const result = await this.agent.invoke({ messages });

    const finalMessages = result.messages || [];
    const lastMessage = finalMessages[finalMessages.length - 1];
    const text =
      typeof lastMessage?.content === "string" ? lastMessage.content : "";

    const outputMessage: ResponseOutputMessage = {
      id: `msg_${randomUUID()}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    };

    return [outputMessage];
  }

  /**
   * Handle a streaming request. Yields Responses API SSE events.
   *
   * Maps LangGraph stream events → ResponseStreamEvent:
   *   on_tool_start  → response.output_item.added / done  (function_call)
   *   on_tool_end    → response.output_item.added / done  (function_call_output)
   *   on_chat_model_stream → response.output_text.delta
   *
   * If you switch SDKs, re-implement this method to yield ResponseStreamEvent
   * from your SDK's streaming output.
   */
  async *stream(params: InvokeParams): AsyncGenerator<ResponseStreamEvent> {
    const { input, chat_history = [] } = params;

    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt),
      ...convertToBaseMessages(chat_history),
      new HumanMessage(input),
    ];

    const toolCallIds = new Map<string, string>();
    let seqNum = 0;
    let outputIndex = 0;
    const textItemId = `msg_${randomUUID()}`;
    let textOutputIndex = -1; // set on first text delta

    const eventStream = this.agent.streamEvents({ messages }, { version: "v2" });

    for await (const event of eventStream) {
      // Tool call started — emit function_call output item
      if (event.event === "on_tool_start") {
        const callId = `call_${randomUUID()}`;
        toolCallIds.set(`${event.name}_${event.run_id}`, callId);

        const fcItem: ResponseFunctionToolCall = {
          id: `fc_${randomUUID()}`,
          call_id: callId,
          name: event.name,
          arguments: JSON.stringify(event.data?.input || {}),
          type: "function_call",
          status: "completed",
        };

        const currentIndex = outputIndex++;

        const added: ResponseOutputItemAddedEvent = {
          type: "response.output_item.added",
          item: fcItem,
          output_index: currentIndex,
          sequence_number: seqNum++,
        };
        yield added;

        const done: ResponseOutputItemDoneEvent = {
          type: "response.output_item.done",
          item: fcItem,
          output_index: currentIndex,
          sequence_number: seqNum++,
        };
        yield done;
      }

      // Tool result received — emit function_call_output item
      if (event.event === "on_tool_end") {
        const toolKey = `${event.name}_${event.run_id}`;
        const callId = toolCallIds.get(toolKey) || `call_${randomUUID()}`;
        toolCallIds.delete(toolKey);

        const outputItem = {
          id: `fco_${randomUUID()}`,
          call_id: callId,
          output: JSON.stringify(event.data?.output || ""),
          type: "function_call_output" as const,
        };

        const currentIndex = outputIndex++;

        yield {
          type: "response.output_item.added",
          item: outputItem,
          output_index: currentIndex,
          sequence_number: seqNum++,
        } as unknown as ResponseStreamEvent;

        yield {
          type: "response.output_item.done",
          item: outputItem,
          output_index: currentIndex,
          sequence_number: seqNum++,
        } as unknown as ResponseStreamEvent;
      }

      // Text chunk from LLM
      if (event.event === "on_chat_model_stream") {
        const content = event.data?.chunk?.content;
        if (content && typeof content === "string") {
          // Emit output_item.added for the text message on first delta
          if (textOutputIndex === -1) {
            textOutputIndex = outputIndex++;

            const msgItem: ResponseOutputMessage = {
              id: textItemId,
              type: "message",
              role: "assistant",
              status: "in_progress",
              content: [],
            };
            const added: ResponseOutputItemAddedEvent = {
              type: "response.output_item.added",
              item: msgItem,
              output_index: textOutputIndex,
              sequence_number: seqNum++,
            };
            yield added;
          }

          const delta: ResponseTextDeltaEvent = {
            type: "response.output_text.delta",
            item_id: textItemId,
            output_index: textOutputIndex,
            content_index: 0,
            delta: content,
            logprobs: [],
            sequence_number: seqNum++,
          };
          yield delta;
        }
      }
    }

    // Close the text output item if we streamed any text
    if (textOutputIndex !== -1) {
      const msgItem: ResponseOutputMessage = {
        id: textItemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [],
      };
      const done: ResponseOutputItemDoneEvent = {
        type: "response.output_item.done",
        item: msgItem,
        output_index: textOutputIndex,
        sequence_number: seqNum++,
      };
      yield done;
    }

    // Signal end of response.
    yield {
      type: "response.completed",
      sequence_number: seqNum++,
      response: {} as any,
    } as unknown as ResponseStreamEvent;
  }
}

/**
 * Create a tool-calling agent with ChatDatabricks
 *
 * Uses standard LangGraph createReactAgent API:
 * - Automatic tool calling and execution
 * - Built-in agentic loop with reasoning
 * - Streaming support out of the box
 * - Compatible with MCP tools
 *
 * @param config Agent configuration
 * @returns AgentInterface instance
 */
export async function createAgent(config: AgentConfig = {}): Promise<AgentInterface> {
  const {
    model: modelName = "databricks-claude-sonnet-4-5",
    useResponsesApi = false,
    temperature = 0.1,
    maxTokens = 2000,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    mcpServers,
  } = config;

  // Create chat model
  const model = new ChatDatabricks({
    model: modelName,
    useResponsesApi,
    temperature,
    maxTokens,
  });

  // Load tools (basic + MCP if configured)
  const tools = await getAllTools(mcpServers);

  console.log(`✅ Agent initialized with ${tools.length} tool(s)`);
  console.log(`   Tools: ${tools.map((t) => t.name).join(", ")}`);

  // Create agent using standard LangGraph API
  const agent = createReactAgent({
    llm: model,
    tools,
  });

  return new StandardAgent(agent, systemPrompt);
}

