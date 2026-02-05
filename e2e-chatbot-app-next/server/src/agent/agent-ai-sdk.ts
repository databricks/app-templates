/**
 * Agent implementation using AI SDK directly (workaround for LangChain tool calling issue)
 *
 * This bypasses the LangChain ChatDatabricks wrapper and uses the AI SDK provider
 * directly with useRemoteToolCalling: false, which ensures tools are passed correctly
 * to foundation model endpoints.
 */

import { generateText, streamText } from "ai";
import { createDatabricksProvider } from "@databricks/ai-sdk-provider";
import { Config } from "@databricks/sdk-experimental";
import { getAllTools } from "./tools.js";
import type { MCPConfig } from "./tools.js";

/**
 * Agent configuration
 */
export interface AgentConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  mcpConfig?: MCPConfig;
  auth?: {
    host?: string;
    token?: string;
  };
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to various tools.

When using tools:
- Think step by step about which tools to use
- Use multiple tools if needed to answer the question thoroughly
- Provide clear explanations of your reasoning
- Cite specific tool results in your responses

Be concise but informative in your responses.`;

/**
 * Create Databricks provider with correct useRemoteToolCalling setting
 */
async function createProvider(auth?: { host?: string; token?: string }) {
  const config = new Config(auth ?? {});
  await config.ensureResolved();

  const globalFetch = globalThis.fetch;

  return createDatabricksProvider({
    baseURL: `${config.host}/serving-endpoints`,
    // CRITICAL: Set to false for foundation model endpoints with client-side tools
    // Set to true only for Agent Bricks or other remote agent endpoints
    useRemoteToolCalling: false,
    fetch: async (url, options) => {
      await config.ensureResolved();
      const headers = new Headers(options?.headers);
      await config.authenticate(headers);
      const response = await globalFetch(url, {
        ...options,
        headers,
      });
      return response;
    },
  });
}

/**
 * Convert LangChain tools to AI SDK format
 */
function convertLangChainToolsToAISDK(langchainTools: any[]) {
  const aiSdkTools: Record<string, any> = {};

  for (const lcTool of langchainTools) {
    aiSdkTools[lcTool.name] = {
      description: lcTool.description,
      parameters: lcTool.schema,
      execute: async (params: any) => {
        return await lcTool.invoke(params);
      },
    };
  }

  return aiSdkTools;
}

/**
 * Generate a response using the agent
 */
export async function invokeAgent(
  input: string,
  config: AgentConfig = {}
): Promise<{ output: string; toolCalls?: any[] }> {
  const {
    model = "databricks-claude-sonnet-4-5",
    temperature = 0.1,
    maxTokens = 2000,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    auth,
    mcpConfig,
  } = config;

  // Load tools
  const langchainTools = await getAllTools(mcpConfig);
  const tools = convertLangChainToolsToAISDK(langchainTools);

  console.log(`🤖 Invoking agent with ${Object.keys(tools).length} tool(s)`);
  console.log(`   Tools: ${Object.keys(tools).join(", ")}`);

  // Create provider
  const provider = await createProvider(auth);
  const languageModel = provider.chatCompletions(model);

  // Generate response
  const result = await generateText({
    model: languageModel,
    system: systemPrompt,
    prompt: input,
    tools,
    maxSteps: 5, // Allow multiple tool calling rounds
    temperature,
    maxOutputTokens: maxTokens,
  });

  console.log(`✅ Response generated`);
  console.log(`   Tool calls: ${result.steps.length - 1}`);
  console.log(`   Finish reason: ${result.finishReason}`);

  return {
    output: result.text,
    toolCalls: result.steps
      .slice(0, -1) // Exclude final text step
      .flatMap((step) => step.toolCalls || []),
  };
}

/**
 * Stream agent responses
 */
export async function* streamAgentText(
  input: string,
  config: AgentConfig = {}
): AsyncGenerator<string> {
  const {
    model = "databricks-claude-sonnet-4-5",
    temperature = 0.1,
    maxTokens = 2000,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    auth,
    mcpConfig,
  } = config;

  // Load tools
  const langchainTools = await getAllTools(mcpConfig);
  const tools = convertLangChainToolsToAISDK(langchainTools);

  console.log(`🤖 Streaming agent with ${Object.keys(tools).length} tool(s)`);

  // Create provider
  const provider = await createProvider(auth);
  const languageModel = provider.chatCompletions(model);

  // Stream response
  const result = streamText({
    model: languageModel,
    system: systemPrompt,
    prompt: input,
    tools,
    maxSteps: 5,
    temperature,
    maxOutputTokens: maxTokens,
  });

  // Stream text deltas
  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

/**
 * Stream full agent events (for debugging)
 */
export async function* streamAgentFull(
  input: string,
  config: AgentConfig = {}
) {
  const {
    model = "databricks-claude-sonnet-4-5",
    temperature = 0.1,
    maxTokens = 2000,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    auth,
    mcpConfig,
  } = config;

  const langchainTools = await getAllTools(mcpConfig);
  const tools = convertLangChainToolsToAISDK(langchainTools);

  const provider = await createProvider(auth);
  const languageModel = provider.chatCompletions(model);

  const result = streamText({
    model: languageModel,
    system: systemPrompt,
    prompt: input,
    tools,
    maxSteps: 5,
    temperature,
    maxOutputTokens: maxTokens,
  });

  // Stream all events
  for await (const chunk of result.fullStream) {
    yield chunk;
  }
}
