/**
 * LangChain agent implementation using ChatDatabricks.
 *
 * Demonstrates:
 * - ChatDatabricks model configuration
 * - Tool binding and execution
 * - Streaming responses
 * - Agent executor setup (for basic tools)
 * - Manual agentic loop (AgentMCP) for MCP tools
 */

import { ChatDatabricks, DatabricksMCPServer } from "@databricks/langchainjs";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
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
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to various tools.

When using tools:
- Think step by step about which tools to use
- Use multiple tools if needed to answer the question thoroughly
- Provide clear explanations of your reasoning
- Cite specific tool results in your responses

When a tool returns an error or fails:
- ALWAYS provide a helpful response to the user
- Explain what went wrong (e.g., permission denied, data not available)
- If possible, provide alternative approaches or general knowledge to help answer the question
- Never leave the user with just an error message - always add context and next steps

Be concise but informative in your responses.`;

/**
 * Create a ChatDatabricks model instance
 */
export function createChatModel(config: AgentConfig) {
  const {
    model = "databricks-claude-sonnet-4-5",
    useResponsesApi = false,
    temperature = 0.1,
    maxTokens = 2000,
    auth,
  } = config;

  return new ChatDatabricks({
    model,
    useResponsesApi,
    temperature,
    maxTokens,
    auth,
  });
}

/**
 * Create agent prompt template
 */
function createAgentPrompt(systemPrompt: string): ChatPromptTemplate {
  return ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    ["placeholder", "{chat_history}"],
    ["human", "{input}"],
    ["placeholder", "{agent_scratchpad}"],
  ]);
}

/**
 * Convert plain message objects to LangChain BaseMessage objects
 * Handles chat history from API requests which may be plain objects
 */
function convertToBaseMessages(messages: any[]): BaseMessage[] {
  return messages.map((msg) => {
    // Already a BaseMessage - return as-is
    if (msg instanceof BaseMessage) {
      return msg;
    }

    // Plain object with role/content - convert to appropriate message type
    const content = msg.content || "";
    switch (msg.role) {
      case "user":
        return new HumanMessage(content);
      case "assistant":
        return new AIMessage(content);
      case "system":
        return new SystemMessage(content);
      default:
        // Fallback to HumanMessage for unknown roles
        return new HumanMessage(content);
    }
  });
}

/**
 * Agent with manual agentic loop for MCP tools
 *
 * This pattern follows the @databricks/langchainjs MCP example:
 * - Use model.bindTools() to bind tools to the model
 * - Manual agentic loop: check tool_calls, execute tools, add ToolMessages
 * - This works correctly with MCP tools from MultiServerMCPClient
 */
export class AgentMCP {
  private model: ChatDatabricks;
  private tools: StructuredToolInterface[];
  private systemPrompt: string;
  private maxIterations: number;

  private constructor(
    model: ChatDatabricks,
    tools: StructuredToolInterface[],
    systemPrompt: string,
    maxIterations: number
  ) {
    this.model = model;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
    this.maxIterations = maxIterations;
  }

  static async create(config: AgentConfig = {}): Promise<AgentMCP> {
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

    // Bind tools to model
    const modelWithTools = model.bindTools(tools);

    return new AgentMCP(modelWithTools as ChatDatabricks, tools, systemPrompt || DEFAULT_SYSTEM_PROMPT, 10);
  }

  /**
   * Invoke the agent with a message
   */
  async invoke(params: { input: string; chat_history?: any[] }) {
    const { input, chat_history = [] } = params;

    // Build messages array - convert chat history to BaseMessages
    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt),
      ...convertToBaseMessages(chat_history),
      new HumanMessage(input),
    ];

    // Manual agentic loop
    let currentResponse = await this.model.invoke(messages);
    let iteration = 0;

    console.log(`[AgentMCP] Initial response has ${currentResponse.tool_calls?.length || 0} tool calls`);

    while (currentResponse.tool_calls && currentResponse.tool_calls.length > 0) {
      iteration++;
      console.log(`[AgentMCP] Iteration ${iteration}: Processing ${currentResponse.tool_calls.length} tool calls`);

      if (iteration > this.maxIterations) {
        console.log(`Max iterations (${this.maxIterations}) reached`);
        break;
      }

      // Add AI message with tool calls
      messages.push(currentResponse);

      // Execute each tool call
      for (const toolCall of currentResponse.tool_calls) {
        const tool = this.tools.find((t) => t.name === toolCall.name);
        if (tool) {
          try {
            const result = await tool.invoke(toolCall.args);

            // Add tool result message
            messages.push(
              new ToolMessage({
                content: typeof result === "string" ? result : JSON.stringify(result),
                tool_call_id: toolCall.id!,
                name: toolCall.name,
              })
            );
          } catch (error: any) {
            // Add error as tool message
            messages.push(
              new ToolMessage({
                content: `Error: ${error.message || error}`,
                tool_call_id: toolCall.id!,
                name: toolCall.name,
              })
            );
          }
        }
      }

      // Get next response
      currentResponse = await this.model.invoke(messages);
    }

    // Extract final text content
    const output = this.getTextContent(currentResponse.content);

    return {
      output,
      intermediateSteps: [],
    };
  }

  /**
   * Stream events from the agent (for observability)
   */
  async *streamEvents(params: { input: string; chat_history?: any[] }, options: { version: string }) {
    const { input, chat_history = [] } = params;

    console.log("[AgentMCP] streamEvents called with:");
    console.log("  Input:", input);
    console.log("  Chat history length:", chat_history.length);
    if (chat_history.length > 0) {
      console.log("  Chat history sample:", JSON.stringify(chat_history.slice(0, 2), null, 2));
    }

    // Build messages array - convert chat history to BaseMessages
    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt),
      ...convertToBaseMessages(chat_history),
      new HumanMessage(input),
    ];

    console.log(`[AgentMCP] Total messages to process: ${messages.length}`);

    // Manual agentic loop with streaming
    let iteration = 0;
    let currentResponse: AIMessage | null = null;

    while (iteration <= this.maxIterations) {
      iteration++;

      // Stream response from model
      let fullContent = "";
      let toolCalls: any[] = [];
      const stream = await this.model.stream(messages);

      for await (const chunk of stream) {
        // Stream text content
        if (chunk.content && typeof chunk.content === "string") {
          fullContent += chunk.content;

          // Yield streaming event compatible with LangChain's streamEvents format
          yield {
            event: "on_chat_model_stream",
            data: {
              chunk: {
                content: chunk.content,
              },
            },
            name: "ChatDatabricks",
            run_id: `run_${Date.now()}`,
          };
        }

        // Collect tool calls
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          toolCalls.push(...chunk.tool_calls);
        }
      }

      // Create complete response message
      currentResponse = new AIMessage({
        content: fullContent,
        tool_calls: toolCalls,
      });

      // If no tool calls, we're done
      if (!toolCalls || toolCalls.length === 0) {
        break;
      }

      // Check if this is the first iteration (initial response before any tools executed)
      const isFirstIteration = iteration === 1;

      // If we're about to execute tools, ensure we have at least some content
      // This prevents the agent from calling tools without explaining what it's doing
      if (isFirstIteration && !fullContent) {
        console.warn("[AgentMCP] Model called tools without providing any explanatory text");
      }

      // Add AI message with tool calls
      messages.push(currentResponse);

      // Track if we executed any tools in this iteration
      let executedTools = false;

      // Execute each tool call
      for (const toolCall of toolCalls) {
        executedTools = true;
        const tool = this.tools.find((t) => t.name === toolCall.name);

        if (tool) {
          // Yield tool start event
          yield {
            event: "on_tool_start",
            data: {
              input: toolCall.args,
            },
            name: toolCall.name,
            run_id: toolCall.id || `tool_${Date.now()}`,
          };

          try {
            const result = await tool.invoke(toolCall.args);
            const resultStr = typeof result === "string" ? result : JSON.stringify(result);

            // Add tool result message
            messages.push(
              new ToolMessage({
                content: resultStr,
                tool_call_id: toolCall.id!,
                name: toolCall.name,
              })
            );

            // Yield tool end event
            yield {
              event: "on_tool_end",
              data: {
                output: resultStr,
              },
              name: toolCall.name,
              run_id: toolCall.id || `tool_${Date.now()}`,
            };
          } catch (error: any) {
            const errorMsg = `Error: ${error.message || error}`;

            // Add error as tool message
            messages.push(
              new ToolMessage({
                content: errorMsg,
                tool_call_id: toolCall.id!,
                name: toolCall.name,
              })
            );

            // Yield tool error event
            yield {
              event: "on_tool_end",
              data: {
                output: errorMsg,
              },
              name: toolCall.name,
              run_id: toolCall.id || `tool_${Date.now()}`,
            };
          }
        }
      }

      // If we executed tools but the next iteration might return empty response,
      // add a system message to prompt the model to provide feedback
      if (executedTools) {
        // Check if any tool returned an error
        const hasToolError = messages.some(
          (msg) => {
            if (msg._getType() !== "tool") return false;
            const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
            return content.includes("Error") || content.includes("PERMISSION_DENIED");
          }
        );

        if (hasToolError) {
          console.log("[AgentMCP] Tool error detected, will ensure model provides response");
          // Add a system reminder to ensure the model responds
          messages.push(
            new SystemMessage(
              "The tool returned an error. You MUST provide a helpful response to the user explaining what happened and offering alternatives or context."
            )
          );
        }
      }

      // Continue loop to get next response
    }

    // Yield agent finish event
    const finalOutput = currentResponse ? this.getTextContent(currentResponse.content) : "";
    yield {
      event: "on_agent_finish",
      data: { output: finalOutput },
    };
  }

  /**
   * Helper to extract text from content
   */
  private getTextContent(content: BaseMessage["content"]): string {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("");
    }
    return "";
  }
}

/**
 * Create a tool-calling agent with ChatDatabricks
 *
 * IMPORTANT: When MCP tools are configured, this uses AgentMCP (manual agentic loop)
 * instead of AgentExecutor, because AgentExecutor doesn't properly handle MCP tool results.
 *
 * See MCP_CORRECT_PATTERN.md for details.
 */
export async function createAgent(
  config: AgentConfig = {}
): Promise<AgentExecutor | AgentMCP> {
  const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  // If MCP servers are configured, use AgentMCP (manual agentic loop)
  // AgentExecutor doesn't work with MCP tools - causes AI_MissingToolResultsError
  if (config.mcpServers && config.mcpServers.length > 0) {
    console.log("✅ Using AgentMCP (manual agentic loop) for MCP tools");
    return AgentMCP.create(config);
  }

  // Otherwise, use standard AgentExecutor for basic tools
  console.log("✅ Using AgentExecutor for basic tools");

  // Create chat model
  const model = createChatModel(config);

  // Load tools (basic + MCP if configured)
  const tools = await getAllTools(config.mcpServers);

  console.log(`✅ Agent initialized with ${tools.length} tool(s)`);
  console.log(
    `   Tools: ${tools.map((t) => t.name).join(", ")}`
  );

  // Create prompt template
  const prompt = createAgentPrompt(systemPrompt);

  // Create tool-calling agent
  const agent = await createToolCallingAgent({
    llm: model,
    tools,
    prompt,
  });

  // Create agent executor
  const executor = new AgentExecutor({
    agent,
    tools,
    verbose: true,
    maxIterations: 10,
  });

  return executor;
}

/**
 * Simple message format for agent invocation
 */
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}
