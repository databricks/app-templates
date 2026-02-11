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
   * Use Responses API for richer outputs (citations, reasoning)
   * Default: false (uses chat completions API)
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

  /**
   * Authentication configuration (optional, uses env vars by default)
   */
  auth?: {
    host?: string;
    token?: string;
  };
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
 * Wraps createReactAgent to provide a simpler interface compatible with
 * the previous manual implementation.
 */
class StandardAgent {
  private agent: Awaited<ReturnType<typeof createReactAgent>>;
  private systemPrompt: string;

  constructor(agent: Awaited<ReturnType<typeof createReactAgent>>, systemPrompt: string) {
    this.agent = agent;
    this.systemPrompt = systemPrompt;
  }

  /**
   * Invoke the agent with a message
   */
  async invoke(params: { input: string; chat_history?: any[] }) {
    const { input, chat_history = [] } = params;

    // Build messages array
    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt),
      ...convertToBaseMessages(chat_history),
      new HumanMessage(input),
    ];

    // Invoke agent with standard LangGraph format
    const result = await this.agent.invoke({
      messages,
    });

    // Extract final message content
    const finalMessages = result.messages || [];
    const lastMessage = finalMessages[finalMessages.length - 1];
    const output = lastMessage?.content || "";

    return {
      output,
      intermediateSteps: [],
    };
  }

  /**
   * Stream events from the agent
   */
  async *streamEvents(params: { input: string; chat_history?: any[] }, options: { version: string }) {
    const { input, chat_history = [] } = params;

    // Build messages array
    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt),
      ...convertToBaseMessages(chat_history),
      new HumanMessage(input),
    ];

    // Stream from agent using standard LangGraph streamEvents
    const stream = this.agent.streamEvents(
      { messages },
      { version: options.version as "v1" | "v2" }
    );

    for await (const event of stream) {
      yield event;
    }
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
 * @returns Agent instance with invoke() and streamEvents() methods
 */
export async function createAgent(
  config: AgentConfig = {}
): Promise<StandardAgent> {
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

  console.log("✅ Agent initialized successfully");

  return new StandardAgent(agent, systemPrompt);
}

/**
 * Simple message format for agent invocation
 */
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}
