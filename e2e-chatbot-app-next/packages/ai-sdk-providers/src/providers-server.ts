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
const LOG_SSE_EVENTS = process.env.LOG_SSE_EVENTS === 'true';

const API_PROXY = process.env.API_PROXY;

// Durable-execution support: when talking to a `LongRunningAgentServer` agent
// (the case when API_PROXY is set in our advanced templates), we
//   1. inject `background: true` so the server persists every SSE frame to its
//      durable store and our retrieve endpoint can resume mid-stream;
//   2. capture the rotated `conversation_id` from the `response.resumed`
//      sentinel and replay it on the next user turn — without this, the next
//      turn lands on the orphan-poisoned session;
//   3. on connection close without `[DONE]`, transparently re-stream from the
//      retrieve endpoint using the last seen sequence number.
//
// All three live here because `databricksFetch` is the single boundary the
// Vercel AI SDK pipes every agent request through.
const MAX_RESUME_ATTEMPTS = 5;
const conversationAliasMap = new Map<string, string>();

function captureRotation(
  json: Record<string, unknown> | null,
  originalChatId: string | null,
): void {
  if (!json || !originalChatId) return;
  if (json.type !== 'response.resumed') return;
  const rotated = json.conversation_id;
  if (typeof rotated === 'string' && rotated.length > 0) {
    conversationAliasMap.set(originalChatId, rotated);
  }
}

function extractResponseId(json: Record<string, unknown> | null): string | null {
  if (!json) return null;
  if (typeof json.response_id === 'string') return json.response_id;
  const resp = json.response as { id?: unknown } | undefined;
  if (resp && typeof resp.id === 'string') return resp.id;
  return null;
}

function buildRetrieveUrl(invocationsUrl: string, responseId: string): string {
  // The bridge mounts GET /responses/{id} on the same origin as POST /invocations.
  const base = invocationsUrl.replace(/\/invocations\/?$/, '');
  return `${base}/responses/${encodeURIComponent(responseId)}`;
}

// Cache for endpoint details to check task type and OBO scopes
const endpointDetailsCache = new Map<
  string,
  { task: string | undefined; userApiScopes: string[]; isOboEnabled: boolean; timestamp: number }
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

  // Mutate the request body for durable execution (when we have a body to
  // mutate). Three things happen here, all conditional:
  //   - Inject context.conversation_id / context.user_id from headers when the
  //     endpoint expects it (existing behavior).
  //   - Substitute conversation_id with any previously-captured rotated alias
  //     so subsequent turns land on the right (post-resume) session.
  //   - Set body.background = true on streaming requests when API_PROXY is
  //     set, so the long-running server persists the stream to its store.
  let originalChatId: string | null = null;
  if (requestInit?.body && typeof requestInit.body === 'string') {
    try {
      const body = JSON.parse(requestInit.body);
      let mutated = false;

      if (conversationId && userId && shouldInjectContext()) {
        body.context = {
          ...(body.context ?? {}),
          conversation_id: conversationId,
          user_id: userId,
        };
        mutated = true;
      }

      const ctx = body.context as { conversation_id?: unknown } | undefined;
      const ctxConvId =
        ctx && typeof ctx.conversation_id === 'string'
          ? ctx.conversation_id
          : null;
      if (ctxConvId) {
        originalChatId = ctxConvId;
        const aliased = conversationAliasMap.get(ctxConvId);
        if (aliased && aliased !== ctxConvId) {
          body.context = { ...body.context, conversation_id: aliased };
          mutated = true;
        }
      }

      if (API_PROXY && body.stream === true && body.background !== true) {
        body.background = true;
        mutated = true;
      }

      if (mutated) {
        requestInit = { ...requestInit, body: JSON.stringify(body) };
      }
    } catch {
      // If JSON parsing fails, pass through unchanged
    }
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

  const response = await fetch(url, requestInit);

  if (response.body) {
    const contentType = response.headers.get('content-type') || '';
    const isSSE =
      contentType.includes('text/event-stream') ||
      contentType.includes('application/x-ndjson');

    if (isSSE) {
      const wrapped = wrapDurableSseStream(
        response.body,
        url,
        requestInit?.headers,
        originalChatId,
      );
      return new Response(wrapped, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  }

  return response;
};

/**
 * Wrap a long-running-server SSE response so we can:
 *   - sniff `response.resumed` frames and update the conversation alias map,
 *   - track the last sequence number and response_id we observed,
 *   - if the upstream stream closes before `[DONE]`, transparently re-stream
 *     from `GET /responses/{id}?stream=true&starting_after=<seq>`.
 *
 * Bytes are passed through untouched; we only sniff data frames.
 */
function wrapDurableSseStream(
  initialBody: ReadableStream<Uint8Array>,
  invocationsUrl: string,
  reqHeaders: HeadersInit | undefined,
  originalChatId: string | null,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventCounter = 0;
  let responseId: string | null = null;
  let lastSeq = -1;
  let sawDone = false;
  let attemptsLeft = MAX_RESUME_ATTEMPTS;

  function processChunk(value: Uint8Array): void {
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        sawDone = true;
        if (LOG_SSE_EVENTS) console.log(`[SSE #${++eventCounter}] [DONE]`);
        continue;
      }
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(data) as Record<string, unknown>;
      } catch {
        if (LOG_SSE_EVENTS) console.log(`[SSE #${++eventCounter}] (raw)`, data);
        continue;
      }
      if (LOG_SSE_EVENTS) {
        console.log(`[SSE #${++eventCounter}]`, JSON.stringify(json));
      }
      captureRotation(json, originalChatId);
      const rid = extractResponseId(json);
      if (rid) responseId = rid;
      const seq = json.sequence_number;
      if (typeof seq === 'number' && seq > lastSeq) lastSeq = seq;
    }
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let currentBody: ReadableStream<Uint8Array> | null = initialBody;

      while (currentBody) {
        const reader = currentBody.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
            processChunk(value);
          }
        } catch (err) {
          if (LOG_SSE_EVENTS) console.warn('[SSE] read error', err);
        } finally {
          reader.releaseLock();
        }

        if (sawDone) break;
        if (!responseId || attemptsLeft <= 0) break;

        attemptsLeft -= 1;
        const startingAfter = Math.max(lastSeq, 0);
        const resumeUrl =
          `${buildRetrieveUrl(invocationsUrl, responseId)}` +
          `?stream=true&starting_after=${startingAfter}`;
        console.log(
          `[SSE] upstream closed without [DONE], resuming response_id=${responseId} from seq=${startingAfter}`,
        );
        try {
          const resp = await fetch(resumeUrl, {
            method: 'GET',
            headers: reqHeaders,
          });
          if (!resp.ok || !resp.body) {
            console.warn(
              `[SSE] resume request failed status=${resp.status}, giving up`,
            );
            break;
          }
          currentBody = resp.body;
        } catch (err) {
          console.warn('[SSE] resume fetch threw, giving up', err);
          break;
        }
      }

      controller.close();
    },
  });
}

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
      const headers = new Headers(init?.headers);

      // If the user's OBO token is present, use it for Authorization so the
      // endpoint sees the user's identity. Keep the header around so
      // downstream agent apps can also read it directly.
      const userToken = headers.get('x-forwarded-access-token');
      if (userToken) {
        headers.set('Authorization', `Bearer ${userToken}`);
      } else {
        const currentToken = await getProviderToken();
        headers.set('Authorization', `Bearer ${currentToken}`);
      }

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

// Response type for serving endpoint details
interface EndpointDetailsResponse {
  task: string | undefined;
  auth_policy?: {
    user_auth_policy: {
      api_scopes: string[];
    };
  };
  tile_endpoint_metadata?: {
    problem_type: string;
  };
}

// Get the task type and OBO scopes of the serving endpoint
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
  const data = (await response.json()) as EndpointDetailsResponse;

  // Detect OBO: either explicit auth_policy scopes, or Supervisor Agent (always OBO).
  // TODO: Remove the isSupervisorAgent special case once the serving endpoint details API
  // returns the full set of required scopes for Supervisor Agents.
  const isSupervisorAgent = data.tile_endpoint_metadata?.problem_type === 'MULTI_AGENT_SUPERVISOR';
  const userApiScopes = data.auth_policy?.user_auth_policy?.api_scopes ?? [];
  const isOboEnabled = userApiScopes.length > 0 || isSupervisorAgent;

  // serving.serving-endpoints is always needed for OBO (to call the endpoint as the user)
  if (isOboEnabled && !userApiScopes.includes('serving.serving-endpoints')) {
    userApiScopes.push('serving.serving-endpoints');
  }

  if (isOboEnabled) {
    console.warn(
      `⚠ OBO detected on endpoint "${servingEndpoint}". Required user authorization scopes: ${JSON.stringify(userApiScopes)}\n` +
      `  → Add scopes to your app via the Databricks UI or in databricks.yml\n` +
      `  → See: https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app#enable-user-authorization`,
    );
  }

  const returnValue = {
    task: data.task as string | undefined,
    userApiScopes,
    isOboEnabled,
    timestamp: Date.now(),
  };
  endpointDetailsCache.set(servingEndpoint, returnValue);
  return returnValue;
};

/**
 * Returns OBO info for the configured serving endpoint.
 * Detects OBO via auth_policy scopes or Supervisor Agent type.
 */
export async function getEndpointOboInfo(): Promise<{ isEndpointOboEnabled: boolean; endpointRequiredScopes: string[] }> {
  const servingEndpoint = process.env.DATABRICKS_SERVING_ENDPOINT;
  if (!servingEndpoint) return { isEndpointOboEnabled: false, endpointRequiredScopes: [] };
  try {
    const details = await getEndpointDetails(servingEndpoint);
    return {
      isEndpointOboEnabled: details.isOboEnabled,
      endpointRequiredScopes: details.userApiScopes,
    };
  } catch {
    return { isEndpointOboEnabled: false, endpointRequiredScopes: [] };
  }
}

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
