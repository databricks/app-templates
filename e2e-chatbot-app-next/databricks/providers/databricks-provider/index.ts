import type { LanguageModelV2, ProviderV2 } from '@ai-sdk/provider';
import {
  combineHeaders,
  type FetchFunction,
  withoutTrailingSlash,
} from '@ai-sdk/provider-utils';
import { DatabricksChatAgentLanguageModel } from './chat-agent-language-model/chat-agent-language-model';
import { DatabricksResponsesAgentLanguageModel } from './responses-agent-language-model/responses-agent-language-model';
import { DatabricksFmapiLanguageModel } from './fmapi-language-model/fmapi-language-model';

export interface DatabricksProvider extends ProviderV2 {
  /** Agents */
  chatAgent(modelId: string): LanguageModelV2; // agent/v2/chat
  responsesAgent(modelId: string): LanguageModelV2; // agent/v2/responses

  /** FMAPI */
  fmapi(modelId: string): LanguageModelV2; // llm/v1/chat
}

export interface DatabricksProviderSettings {
  /** Base URL for the Databricks API calls. */
  baseURL: string;
  /** Custom headers to include in the requests. */
  headers?: Record<string, string>;
  /** Provider name. Overrides the `databricks` default name for 3rd party providers. */
  provider?: string;

  /**
   * Custom fetch implementation. You can use it as a middleware to intercept requests,
   * or to provide a custom fetch implementation for e.g. testing.
   * */
  fetch?: FetchFunction;
}

export const createDatabricksProvider = (
  settings: DatabricksProviderSettings,
): DatabricksProvider => {
  const baseUrl = withoutTrailingSlash(settings.baseURL);
  const getHeaders = () => combineHeaders(settings.headers);
  const fetch = settings.fetch;
  const provider = settings.provider ?? 'databricks';

  const createChatAgent = (modelId: string): LanguageModelV2 =>
    new DatabricksChatAgentLanguageModel(modelId, {
      url: ({ path }) => `${baseUrl}${path}`,
      headers: getHeaders,
      fetch,
      provider,
    });

  const createResponsesAgent = (modelId: string): LanguageModelV2 =>
    new DatabricksResponsesAgentLanguageModel(modelId, {
      url: ({ path }) => `${baseUrl}${path}`,
      headers: getHeaders,
      fetch,
      provider,
    });

  const createFmapi = (modelId: string): LanguageModelV2 =>
    new DatabricksFmapiLanguageModel(modelId, {
      url: ({ path }) => `${baseUrl}${path}`,
      headers: getHeaders,
      fetch,
      provider,
    });

  const notImplemented = (name: string) => {
    return () => {
      throw new Error(`${name} is not supported yet`);
    };
  };

  return {
    chatAgent: createChatAgent,
    responsesAgent: createResponsesAgent,
    fmapi: createFmapi,
    imageModel: notImplemented('ImageModel'),
    textEmbeddingModel: notImplemented('TextEmbeddingModel'),
    languageModel: notImplemented('LanguageModel'),
  };
};
