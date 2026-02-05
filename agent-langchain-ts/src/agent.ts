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
 */
export async function createAgent(
  config: AgentConfig = {}
): Promise<AgentExecutor> {
  const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

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

/**
 * Agent response
 */
export interface AgentResponse {
  output: string;
  intermediateSteps?: Array<{
    action: string;
    observation: string;
  }>;
}

/**
 * Invoke the agent with a message
 */
export async function invokeAgent(
  agent: AgentExecutor,
  input: string,
  chatHistory: AgentMessage[] = []
): Promise<AgentResponse> {
  try {
    const result = await agent.invoke({
      input,
      chat_history: chatHistory,
    });

    return {
      output: result.output,
      intermediateSteps: result.intermediateSteps?.map(
        (step: any) => ({
          action: step.action?.tool || "unknown",
          observation: step.observation,
        })
      ),
    };
  } catch (error) {
    console.error("Agent invocation error:", error);
    throw error;
  }
}

/**
 * Stream agent responses
 */
export async function* streamAgent(
  agent: AgentExecutor,
  input: string,
  chatHistory: AgentMessage[] = []
): AsyncGenerator<string> {
  try {
    const stream = await agent.stream({
      input,
      chat_history: chatHistory,
    });

    for await (const chunk of stream) {
      // Agent executor streams steps, extract text from output
      if (chunk.output) {
        yield chunk.output;
      }
    }
  } catch (error) {
    console.error("Agent streaming error:", error);
    throw error;
  }
}

/**
 * Example: Run agent in a simple chat loop
 */
export async function runAgentDemo(config: AgentConfig = {}) {
  console.log("🤖 Initializing LangChain agent...\n");

  const agent = await createAgent(config);

  // Example queries
  const queries = [
    "What's the weather in San Francisco?",
    "Calculate 15 * 32 + 108",
    "What time is it in Tokyo?",
  ];

  for (const query of queries) {
    console.log(`\n📝 User: ${query}`);

    const response = await invokeAgent(agent, query);

    console.log(`\n🤖 Assistant: ${response.output}`);

    if (response.intermediateSteps && response.intermediateSteps.length > 0) {
      console.log("\n🔧 Tool calls:");
      for (const step of response.intermediateSteps) {
        console.log(`   - ${step.action}: ${step.observation}`);
      }
    }
  }

  console.log("\n✅ Demo complete");
}
