/**
 * LangChain agent implementation using ChatDatabricks.
 *
 * Demonstrates:
 * - ChatDatabricks model configuration
 * - Tool binding and execution
 * - Streaming responses
 * - Agent executor setup
 */

import { ChatDatabricks } from "@databricks/langchainjs";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getAllTools, type MCPConfig } from "./tools.js";
import { AgentMCP } from "./agent-mcp-pattern.js";

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
   * MCP configuration for additional tools
   */
  mcpConfig?: MCPConfig;

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

  // If MCP tools are configured, use AgentMCP (manual agentic loop)
  // AgentExecutor doesn't work with MCP tools - causes AI_MissingToolResultsError
  if (config.mcpConfig && Object.values(config.mcpConfig).some((v) => v)) {
    console.log("✅ Using AgentMCP (manual agentic loop) for MCP tools");
    return AgentMCP.create({
      model: config.model,
      useResponsesApi: config.useResponsesApi,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPrompt,
      mcpConfig: config.mcpConfig,
      maxIterations: 10,
    });
  }

  // Otherwise, use standard AgentExecutor for basic tools
  console.log("✅ Using AgentExecutor for basic tools");

  // Create chat model
  const model = createChatModel(config);

  // Load tools (basic + MCP if configured)
  const tools = await getAllTools(config.mcpConfig);

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
