import type { LanguageModelV3 } from '@ai-sdk/provider';

import { getHostUrl } from '@chat-template/utils';
// Import auth module directly
import {
  getDatabricksToken,
  getAuthMethod,
  getDatabricksUserIdentity,
  getCachedCliHost,
} from '@chat-template/auth';
import { createDatabricksProvider } from '@databricks/ai-sdk-provider';
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai';

// Use centralized authentication - only on server side
async function getProviderToken(): Promise<string> {
  // First, check if we have a PAT token
  if (process.env.DATABRICKS_TOKEN) {
    console.log('Using PAT token from DATABRICKS_TOKEN env var');
    return process.env.DATABRICKS_TOKEN;
  }

  // Otherwise, use centralized authentication module
  return getDatabricksToken();
}

// Cache the workspace hostname once resolved
let cachedWorkspaceHostname: string | null = null;

// Get workspace hostname with one-time resolution and caching
export async function getWorkspaceHostname(): Promise<string> {
  if (cachedWorkspaceHostname) {
    return cachedWorkspaceHostname;
  }

  try {
    // Use the same approach as getDatabricksCurrentUser to get hostname
    const authMethod = getAuthMethod();

    if (authMethod === 'cli') {
      // For CLI auth, we need to call getDatabricksUserIdentity which handles hostname resolution
      // This will trigger the CLI auth flow and properly cache the host
      await getDatabricksUserIdentity();

      // After CLI auth succeeds, get the hostname from the CLI cache
      const cliHost = getCachedCliHost();
      if (cliHost) {
        cachedWorkspaceHostname = cliHost;
        return cachedWorkspaceHostname;
      } else {
        throw new Error(
          'CLI authentication succeeded but hostname was not cached',
        );
      }
    } else {
      // For OAuth, use the standard method
      cachedWorkspaceHostname = getHostUrl();
      return cachedWorkspaceHostname;
    }
  } catch (error) {
    throw new Error(
      `Unable to determine Databricks workspace hostname: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

// Environment variable to enable SSE logging
const LOG_SSE_EVENTS = process.env.LOG_SSE_EVENTS === 'true';

// Global map to store trace IDs by request ID
const traceIdMap = new Map<string, string>();

// Store the most recent trace ID (for single-user dev testing)
let lastTraceId: string | null = null;

// Export function to retrieve trace ID by request/chat ID
export function getTraceIdForRequest(requestId: string): string | null {
  return traceIdMap.get(requestId) || null;
}

// Export function to get the most recent trace ID (useful for chat streaming)
export function getLastTraceId(): string | null {
  return lastTraceId;
}

// Clean up old entries (older than 5 minutes)
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  // Simple cleanup - in production you'd track timestamps
  if (traceIdMap.size > 1000) {
    traceIdMap.clear();
  }
}, 60000);

// Custom fetch function to transform Databricks responses to OpenAI format
export const databricksFetch: typeof fetch = async (input, init) => {
  const url = input.toString();
  let modifiedInit = init;

  // Inject databricks_options for Responses API to get trace IDs.
  // @databricks/ai-sdk-provider v0.4.1 does not forward providerOptions
  // to the request body, so we inject here instead.
  if (init?.body && url.includes('/responses')) {
    try {
      const requestBody =
        typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      if (!requestBody.databricks_options) {
        requestBody.databricks_options = { return_trace: true };
      }
      modifiedInit = { ...init, body: JSON.stringify(requestBody) };
    } catch (_e) {
      // Keep original init if body can't be parsed
    }
  }

  // Log the (possibly modified) request
  if (modifiedInit?.body) {
    try {
      const requestBody =
        typeof modifiedInit.body === 'string'
          ? JSON.parse(modifiedInit.body)
          : modifiedInit.body;
      console.log(
        'Databricks request:',
        JSON.stringify(
          { url, method: modifiedInit.method || 'POST', body: requestBody },
          null,
          2,
        ),
      );
    } catch (_e) {
      console.log('Databricks request (raw):', {
        url,
        method: modifiedInit.method || 'POST',
        body: modifiedInit.body,
      });
    }
  }

  const response = await fetch(url, modifiedInit);

  // If SSE logging is enabled and this is a streaming response, wrap the body to log events
  if (LOG_SSE_EVENTS && response.body) {
    const contentType = response.headers.get('content-type') || '';
    const isSSE =
      contentType.includes('text/event-stream') ||
      contentType.includes('application/x-ndjson');

    if (isSSE) {
      const originalBody = response.body;
      const reader = originalBody.getReader();
      const decoder = new TextDecoder();
      let eventCounter = 0;
      let extractedTraceId: string | null = null;

      const loggingStream = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();

          if (done) {
            console.log('[SSE] Stream ended');
            controller.close();
            return;
          }

          // Decode and log the chunk
          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n').filter((line) => line.trim());

          for (const line of lines) {
            eventCounter++;
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              try {
                const parsed = JSON.parse(data);
                console.log(`[SSE #${eventCounter}]`, JSON.stringify(parsed));

                // Extract trace_id from databricks_output if present
                if (!extractedTraceId && parsed.databricks_output?.trace?.info?.trace_id) {
                  extractedTraceId = parsed.databricks_output.trace.info.trace_id;
                  lastTraceId = extractedTraceId; // Store as last trace ID
                  const requestId = parsed.databricks_output.databricks_request_id || parsed.id;
                  if (requestId) {
                    traceIdMap.set(requestId, extractedTraceId);
                    console.log(`[SSE] ✅ Stored trace_id ${extractedTraceId} for request ${requestId}`);
                  }
                }
              } catch {
                console.log(`[SSE #${eventCounter}] (raw)`, data);
              }
            } else if (line.trim()) {
              console.log(`[SSE #${eventCounter}] (line)`, line);
            }
          }

          // Pass the original data through
          controller.enqueue(value);
        },
        cancel() {
          reader.cancel();
        },
      });

      // Create a new response with the logging stream
      return new Response(loggingStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  }

  return response;
};

type CachedProvider = ReturnType<typeof createDatabricksProvider>;
let oauthProviderCache: CachedProvider | null = null;
let oauthProviderCacheTime = 0;
const PROVIDER_CACHE_DURATION = 5 * 60 * 1000; // Cache provider for 5 minutes

const API_PROXY = process.env.API_PROXY;

// Helper function to get or create the Databricks provider with OAuth
async function getOrCreateDatabricksProvider(): Promise<CachedProvider> {
  // Check if we have a cached provider that's still fresh
  if (
    oauthProviderCache &&
    Date.now() - oauthProviderCacheTime < PROVIDER_CACHE_DURATION
  ) {
    console.log('Using cached OAuth provider');
    return oauthProviderCache;
  }

  console.log('Creating new OAuth provider');
  // Ensure we have a valid token before creating provider
  await getProviderToken();
  const hostname = await getWorkspaceHostname();

  // Create provider with fetch that always uses fresh token
  const provider = createDatabricksProvider({
    baseURL: `${hostname}/serving-endpoints`,
    formatUrl: ({ baseUrl, path }) => API_PROXY ?? `${baseUrl}${path}`,
    fetch: async (...[input, init]: Parameters<typeof fetch>) => {
      // Always get fresh token for each request (will use cache if valid)
      const currentToken = await getProviderToken();
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${currentToken}`);

      return databricksFetch(input, {
        ...init,
        headers,
      });
    },
  });

  oauthProviderCache = provider;
  oauthProviderCacheTime = Date.now();
  return provider;
}

const endpointDetailsCache = new Map<
  string,
  { task: string | undefined; timestamp: number }
>();
const ENDPOINT_DETAILS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Get the task type of the serving endpoint
const getEndpointDetails = async (servingEndpoint: string) => {
  const cached = endpointDetailsCache.get(servingEndpoint);
  if (
    cached &&
    Date.now() - cached.timestamp < ENDPOINT_DETAILS_CACHE_DURATION
  ) {
    return cached;
  }

  // Always get fresh token for each request (will use cache if valid)
  const currentToken = await getProviderToken();
  const hostname = await getWorkspaceHostname();
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${currentToken}`);

  const response = await databricksFetch(
    `${hostname}/api/2.0/serving-endpoints/${servingEndpoint}`,
    {
      method: 'GET',
      headers,
    },
  );
  const data = (await response.json()) as { task: string | undefined };
  const returnValue = {
    task: data.task as string | undefined,
    timestamp: Date.now(),
  };
  endpointDetailsCache.set(servingEndpoint, returnValue);
  return returnValue;
};

// Create a smart provider wrapper that handles OAuth initialization
interface SmartProvider {
  languageModel(id: string): Promise<LanguageModelV3>;
}

export class OAuthAwareProvider implements SmartProvider {
  private modelCache = new Map<
    string,
    { model: LanguageModelV3; timestamp: number }
  >();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  async languageModel(id: string): Promise<LanguageModelV3> {
    // Check cache first
    const cached = this.modelCache.get(id);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      console.log(`Using cached model for ${id}`);
      return cached.model;
    }

    // Get the OAuth provider
    const provider = await getOrCreateDatabricksProvider();

    const model = await (async () => {
      if (API_PROXY) {
        // For API proxy we always use the responses agent
        return provider.responses(id);
      }
      if (id === 'title-model' || id === 'artifact-model') {
        return provider.chatCompletions(
          'databricks-meta-llama-3-3-70b-instruct',
        );
      }
      // Server-side environment validation
      if (!process.env.DATABRICKS_SERVING_ENDPOINT) {
        throw new Error(
          'Please set the DATABRICKS_SERVING_ENDPOINT environment variable to the name of an agent serving endpoint',
        );
      }

      const servingEndpoint = process.env.DATABRICKS_SERVING_ENDPOINT;
      const endpointDetails = await getEndpointDetails(servingEndpoint);

      console.log(`Creating fresh model for ${id}`);
      switch (endpointDetails.task) {
        case 'agent/v2/chat':
          return provider.chatAgent(servingEndpoint);
        case 'agent/v1/responses':
        case 'agent/v2/responses':
          return provider.responses(servingEndpoint);
        case 'llm/v1/chat':
          return provider.chatCompletions(servingEndpoint);
        default:
          return provider.responses(servingEndpoint);
      }
    })();

    const wrappedModel = wrapLanguageModel({
      model,
      middleware: [extractReasoningMiddleware({ tagName: 'think' })],
    });

    // Cache the model
    this.modelCache.set(id, { model: wrappedModel, timestamp: Date.now() });
    return wrappedModel;
  }
}

// Create a singleton instance
const providerInstance = new OAuthAwareProvider();

// Export function that returns the provider (no server function needed here)
export function getDatabricksServerProvider() {
  return providerInstance;
}
