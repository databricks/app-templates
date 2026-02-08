/**
 * Alternative agent implementation using manual agentic loop for MCP tools
 *
 * This pattern follows the @databricks/langchainjs MCP example:
 * - Use model.bindTools() to bind tools to the model
 * - Manual agentic loop: check tool_calls, execute tools, add ToolMessages
 * - This works correctly with MCP tools from MultiServerMCPClient
 */

import { ChatDatabricks } from "@databricks/langchainjs";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { getAllTools, type MCPConfig } from "./tools.js";
import type { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Agent configuration
 */
export interface AgentConfigMCP {
  model?: string;
  useResponsesApi?: boolean;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  mcpConfig?: MCPConfig;
  maxIterations?: number;
}

/**
 * Default system prompt
 */
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to various tools.

When using tools:
- Think step by step about which tools to use
- Use multiple tools if needed to answer the question thoroughly
- Provide clear explanations of your reasoning
- Cite specific tool results in your responses

Be concise but informative in your responses.`;

/**
 * Agent with manual agentic loop for MCP tools
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

  static async create(config: AgentConfigMCP = {}): Promise<AgentMCP> {
    const {
      model: modelName = "databricks-claude-sonnet-4-5",
      useResponsesApi = false,
      temperature = 0.1,
      maxTokens = 2000,
      systemPrompt = DEFAULT_SYSTEM_PROMPT,
      mcpConfig,
      maxIterations = 10,
    } = config;

    // Create chat model
    const model = new ChatDatabricks({
      model: modelName,
      useResponsesApi,
      temperature,
      maxTokens,
    });

    // Load tools (basic + MCP if configured)
    const tools = await getAllTools(mcpConfig);

    console.log(`✅ Agent initialized with ${tools.length} tool(s)`);
    console.log(`   Tools: ${tools.map((t) => t.name).join(", ")}`);

    // Bind tools to model
    const modelWithTools = model.bindTools(tools);

    return new AgentMCP(modelWithTools as ChatDatabricks, tools, systemPrompt, maxIterations);
  }

  /**
   * Invoke the agent with a message
   */
  async invoke(params: { input: string; chat_history?: any[] }) {
    const { input, chat_history = [] } = params;

    // Build messages array
    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt),
      ...chat_history,
      new HumanMessage(input),
    ];

    // Manual agentic loop
    let currentResponse = await this.model.invoke(messages);
    let iteration = 0;

    while (currentResponse.tool_calls && currentResponse.tool_calls.length > 0) {
      iteration++;
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
    // For now, just invoke and yield the result
    // Could be enhanced to stream actual events
    const result = await this.invoke(params);

    yield {
      event: "on_agent_finish",
      data: { output: result.output },
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
 * Create agent using MCP pattern (for backward compatibility)
 */
export async function createAgentMCP(config: AgentConfigMCP = {}) {
  return AgentMCP.create(config);
}
