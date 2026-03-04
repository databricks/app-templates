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
import { shouldInjectContextForEndpoint } from './request-context';

// Header keys for passing context through streamText headers
export const CONTEXT_HEADER_CONVERSATION_ID = 'x-databricks-conversation-id';
export const CONTEXT_HEADER_USER_ID = 'x-databricks-user-id';

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
// - "true": high-level summary (event types, still-streaming, stream end)
// - "verbose": log every single event (for deep debugging)
const LOG_SSE_EVENTS =
  process.env.LOG_SSE_EVENTS === 'true' ||
  process.env.LOG_SSE_EVENTS === 'verbose';
const LOG_SSE_VERBOSE = process.env.LOG_SSE_EVENTS === 'verbose';

const API_PROXY = process.env.API_PROXY;

// Reconnection config for long-running agent streams
const LONG_RUNNING_MAX_RECONNECT_RETRIES = Number.parseInt(
  process.env.LONG_RUNNING_MAX_RECONNECT_RETRIES ?? '60',
  10,
);
const LONG_RUNNING_RECONNECT_BACKOFF_MS = Number.parseInt(
  process.env.LONG_RUNNING_RECONNECT_BACKOFF_MS ?? '1000',
  10,
);

export type BackgroundMode = 'direct' | 'streaming';

/**
 * Resolve background mode from headers.
 * Supports X-Background-Mode (direct|streaming) and legacy X-Use-Background-Mode (true|false).
 */
function getBackgroundMode(headers: Headers): BackgroundMode {
  const mode = headers.get('X-Background-Mode');
  if (mode === 'direct' || mode === 'streaming') {
    return mode;
  }
  const legacy = headers.get('X-Use-Background-Mode');
  if (legacy === 'false') return 'direct';
  return 'streaming';
}

/**
 * Async generator that fetches from the agent retrieve endpoint and reconnects
 * when the stream ends without [DONE] (e.g. proxy timeout). Tracks sequence_number
 * and reconnects with starting_after for resumption.
 */
async function* createReconnectingAgentStream(
  responseId: string,
  baseUrl: string,
  headers: Headers,
  maxRetries = LONG_RUNNING_MAX_RECONNECT_RETRIES,
  backoffMs = LONG_RUNNING_RECONNECT_BACKOFF_MS,
  startingAfter = 0,
): AsyncGenerator<Uint8Array> {
  let lastSeq = startingAfter;
  let retries = 0;
  const decoder = new TextDecoder();
  let buffer = '';

  while (retries <= maxRetries) {
    const url = `${baseUrl}/responses/${responseId}?stream=true&starting_after=${lastSeq}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      console.warn(
        `[STREAM_DEBUG] provider reconnect failed responseId=${responseId} status=${res.status}`,
      );
      break;
    }

    if (!res.body) break;
    const reader = res.body.getReader();
    let skipFirst = lastSeq > 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line) continue;
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try {
              const parsed = JSON.parse(data) as {
                type?: string;
                sequence_number?: number;
              };
              if (parsed.sequence_number != null) {
                lastSeq = parsed.sequence_number;
              }
              if (skipFirst && parsed.type === 'response.created') {
                skipFirst = false;
                continue;
              }
            } catch {
              // Not JSON, pass through
            }
          }
          yield new TextEncoder().encode(`${part}\n\n`);
        }
      }
    } finally {
      reader.releaseLock();
    }

    retries++;
    if (retries <= maxRetries) {
      console.log(
        `[STREAM_DEBUG] provider reconnecting responseId=${responseId} attempt=${retries} lastSeq=${lastSeq}`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

/**
 * Stream from POST response, resuming via GET when connection drops without [DONE].
 * Uses Responses API format: response ID from parsed.response.id.
 */
async function* streamFromPostWithResume(
  postResponse: Response,
  baseUrl: string,
  headers: Headers,
): AsyncGenerator<Uint8Array> {
  if (!postResponse.body) return;
  const reader = postResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let responseId: string | null = null;
  let lastSeq = 0;
  let gotDone = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const line = part.trim();
        if (!line) continue;
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            gotDone = true;
            yield new TextEncoder().encode(`${part}\n\n`);
            return;
          }
          try {
            const parsed = JSON.parse(data) as {
              type?: string;
              response?: { id?: string };
              sequence_number?: number;
            };
            if (parsed.response?.id) responseId = parsed.response.id;
            if (parsed.sequence_number != null)
              lastSeq = parsed.sequence_number;
          } catch {
            // Not JSON, pass through
          }
        }
        yield new TextEncoder().encode(`${part}\n\n`);
      }
    }
  } catch (err) {
    // Connection drops (timeout, reset, etc.) typically throw rather than return done.
    // Fall through to resume logic if we have responseId.
    console.warn(
      '[STREAM_DEBUG] POST stream error, attempting resume:',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    reader.releaseLock();
  }

  if (responseId && !gotDone) {
    console.log(
      `[STREAM_DEBUG] POST stream ended without [DONE], resuming via GET responseId=${responseId} starting_after=${lastSeq}`,
    );
    yield* createReconnectingAgentStream(
      responseId,
      baseUrl,
      headers,
      LONG_RUNNING_MAX_RECONNECT_RETRIES,
      LONG_RUNNING_RECONNECT_BACKOFF_MS,
      lastSeq,
    );
  }
}

// When API_PROXY is set, use background=true + poll flow for long-running agent support.
// Set USE_LONG_RUNNING_MODE=false to opt out and use direct streamText.
const USE_LONG_RUNNING_MODE =
  process.env.USE_LONG_RUNNING_MODE !== 'false' && Boolean(API_PROXY);

// Cache for endpoint details to check task type
const endpointDetailsCache = new Map<
  string,
  { task: string | undefined; timestamp: number }
>();
const ENDPOINT_DETAILS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Checks if context should be injected based on cached endpoint details.
 * Returns true if API_PROXY is set or if the endpoint task type is agent/v2/chat or agent/v1/responses.
 */
function shouldInjectContext(): boolean {
  const servingEndpoint = process.env.DATABRICKS_SERVING_ENDPOINT;
  if (!servingEndpoint) {
    return Boolean(API_PROXY);
  }

  const cached = endpointDetailsCache.get(servingEndpoint);
  const endpointTask = cached?.task;

  return shouldInjectContextForEndpoint(endpointTask);
}

// Custom fetch function to transform Databricks responses to OpenAI format
export const databricksFetch: typeof fetch = async (input, init) => {
  const url = input.toString();
  let requestInit = init;

  // Extract context from headers (passed via streamText headers option)
  const headers = new Headers(requestInit?.headers);
  const conversationId = headers.get(CONTEXT_HEADER_CONVERSATION_ID);
  const userId = headers.get(CONTEXT_HEADER_USER_ID);
  // Remove context headers so they don't get sent to the API
  headers.delete(CONTEXT_HEADER_CONVERSATION_ID);
  headers.delete(CONTEXT_HEADER_USER_ID);
  requestInit = { ...requestInit, headers };

  // Inject context into request body if appropriate
  if (
    conversationId &&
    userId &&
    requestInit?.body &&
    typeof requestInit.body === 'string'
  ) {
    if (shouldInjectContext()) {
      try {
        const body = JSON.parse(requestInit.body);
        const enhancedBody = {
          ...body,
          context: {
            ...body.context,
            conversation_id: conversationId,
            user_id: userId,
          },
        };
        requestInit = { ...requestInit, body: JSON.stringify(enhancedBody) };
      } catch {
        // If JSON parsing fails, pass through unchanged
      }
    }
  }

  // Long-running mode: add background=true for streaming when using API_PROXY
  // Skip for title-model and artifact-model - they are quick calls
  const backgroundMode = getBackgroundMode(headers);
  const useBackground = backgroundMode === 'streaming';
  if (
    USE_LONG_RUNNING_MODE &&
    useBackground &&
    requestInit?.method === 'POST' &&
    requestInit?.body &&
    typeof requestInit.body === 'string'
  ) {
    try {
      const body = JSON.parse(requestInit.body) as { model?: string };
      if (body.model !== 'title-model' && body.model !== 'artifact-model') {
        console.log(
          `[STREAM_DEBUG] provider adding background=true mode=${backgroundMode}`,
        );
        const enhancedBody = {
          ...body,
          background: true,
          stream: true,
        };
        requestInit = {
          ...requestInit,
          body: JSON.stringify(enhancedBody),
        };
      }
    } catch {
      // If JSON parsing fails, pass through unchanged
    }
  } else if (USE_LONG_RUNNING_MODE && backgroundMode === 'direct') {
    console.log('[STREAM_DEBUG] provider using direct streaming');
  }

  // Log the request being sent to Databricks
  if (requestInit?.body) {
    try {
      const requestBody =
        typeof requestInit.body === 'string'
          ? JSON.parse(requestInit.body)
          : requestInit.body;
      console.log(
        'Databricks request:',
        JSON.stringify({
          url,
          method: requestInit.method || 'POST',
          body: requestBody,
        }),
      );
    } catch (_e) {
      console.log('Databricks request (raw):', {
        url,
        method: requestInit.method || 'POST',
        body: requestInit.body,
      });
    }
  }

  let response = await fetch(url, requestInit);

  // Long-running mode: stream from POST directly, use GET only for resume
  if (
    USE_LONG_RUNNING_MODE &&
    useBackground &&
    requestInit?.method === 'POST' &&
    response.ok
  ) {
    const contentType = response.headers.get('content-type') || '';
    const isSSE =
      contentType.includes('text/event-stream') ||
      contentType.includes('application/x-ndjson');

    const baseUrl = new URL(url).origin;
    const fetchHeaders = new Headers(requestInit?.headers);

    if (isSSE && backgroundMode === 'streaming') {
      console.log(
        '[STREAM_DEBUG] provider streaming from POST, will resume via GET if connection drops',
      );
      const postStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamFromPostWithResume(
              response,
              baseUrl,
              fetchHeaders,
            )) {
              controller.enqueue(chunk);
            }
          } finally {
            controller.close();
          }
        },
      });
      response = new Response(postStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
  }

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
      let lastLoggedType: string | null = null;
      const STILL_STREAMING_INTERVAL = 50;

      const loggingStream = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();

          if (done) {
            console.log(`[SSE] Stream ended (${eventCounter} events)`);
            controller.close();
            return;
          }

          // Decode and process the chunk
          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n').filter((line) => line.trim());

          for (const line of lines) {
            eventCounter++;
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              try {
                const parsed = JSON.parse(data) as {
                  type?: string;
                  object?: string;
                };
                const eventType =
                  parsed.type ?? parsed.object ?? 'unknown';

                if (LOG_SSE_VERBOSE) {
                  console.log(
                    `[SSE #${eventCounter}]`,
                    JSON.stringify(parsed),
                  );
                } else {
                  // Summary mode: log event type when it changes
                  if (eventType !== lastLoggedType) {
                    console.log(
                      `[SSE] event #${eventCounter}: ${eventType}`,
                    );
                    lastLoggedType = eventType;
                  } else if (
                    eventCounter % STILL_STREAMING_INTERVAL ===
                    0
                  ) {
                    console.log(
                      `[SSE] still streaming (${eventCounter} events, type=${eventType})`,
                    );
                  }
                }
              } catch {
                if (LOG_SSE_VERBOSE) {
                  console.log(`[SSE #${eventCounter}] (raw)`, data);
                }
              }
            } else if (line.trim() && LOG_SSE_VERBOSE) {
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
    // When using endpoints such as Agent Bricks or custom agents, we need to use remote tool calling to handle the tool calls
    useRemoteToolCalling: true,
    baseURL: `${hostname}/serving-endpoints`,
    formatUrl: ({ baseUrl, path }) => API_PROXY ?? `${baseUrl}${path}`,
    fetch: async (...[input, init]: Parameters<typeof fetch>) => {
      // Always get fresh token for each request (will use cache if valid)
      const currentToken = await getProviderToken();
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${currentToken}`);
      if (API_PROXY) {
        headers.set('x-mlflow-return-trace-id', 'true');
      }

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
