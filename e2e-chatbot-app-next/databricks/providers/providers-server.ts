import { extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getHostUrl } from '@/databricks/utils/databricks-host-utils';
import type {
  LanguageModelV2,
  LanguageModelV2Middleware,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider';
import { composeDatabricksStreamPartTransformers } from '../stream-transformers/databricks-stream-part-transformers';
import {
  applyDatabricksToolCallStreamPartTransform,
  DATABRICKS_TOOL_CALL_ID,
} from '../stream-transformers/databricks-tool-calling';
import { applyDatabricksTextPartTransform } from '../stream-transformers/databricks-text-parts';
import { applyDatabricksRawChunkStreamPartTransform } from '../stream-transformers/databricks-raw-chunk-transformer';

// Import auth module directly
import {
  getDatabricksToken,
  getAuthMethod,
  getDatabricksUserIdentity,
  getCachedCliHost,
} from '@/databricks/auth/databricks-auth';

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
async function getWorkspaceHostname(): Promise<string> {
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

// Custom fetch function to transform Databricks responses to OpenAI format
const databricksFetch: typeof fetch = async (input, init) => {
  const url = input.toString();

  // Log the request being sent to Databricks
  if (init?.body) {
    try {
      const requestBody =
        typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      console.log(
        'Databricks request:',
        JSON.stringify({
          url,
          method: init.method || 'POST',
          body: requestBody,
        }),
      );
    } catch (e) {
      console.log('Databricks request (raw):', {
        url,
        method: init.method || 'POST',
        body: init.body,
      });
    }
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    return response;
  }

  const contentType = response.headers.get('content-type');

  // Handle streaming responses (text/event-stream) - add raw logging
  if (contentType?.includes('text/event-stream')) {
    return response;
  }

  // Handle non-streaming JSON responses
  if (!contentType?.includes('application/json')) {
    return response;
  }

  const data = await response.json();

  // Add fields that are missing from Databricks' ResponsesAgent output chunks
  if (data.object === 'response' && data.output && Array.isArray(data.output)) {
    const transformedData = {
      ...data,
      created_at: Math.floor(Date.now() / 1000),
      output: data.output.map((msg: any) => ({
        ...msg,
        content: msg.content.map((content: any) => ({
          ...content,
          annotations: [],
        })),
      })),
      incomplete_details: null,
      usage: {
        input_tokens: 0,
        output_tokens: data.output[0]?.content?.[0]?.text?.length
          ? Math.ceil(data.output[0].content[0].text.length / 4)
          : 0,
        total_tokens: data.output[0]?.content?.[0]?.text?.length
          ? Math.ceil(data.output[0].content[0].text.length / 4)
          : 0,
      },
      model: 'TODO: unknown',
    };

    return new Response(JSON.stringify(transformedData), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

let oauthProviderCache: ReturnType<typeof createOpenAI> | null = null;
let oauthProviderCacheTime = 0;
const PROVIDER_CACHE_DURATION = 5 * 60 * 1000; // Cache provider for 5 minutes

// Helper function to get or create the Databricks provider with OAuth
async function getOrCreateDatabricksProvider(): Promise<
  ReturnType<typeof createOpenAI>
> {
  // Check if we have a cached provider that's still fresh
  if (
    oauthProviderCache &&
    Date.now() - oauthProviderCacheTime < PROVIDER_CACHE_DURATION
  ) {
    console.log('Using cached OAuth provider');
    return oauthProviderCache;
  }

  console.log('Creating new OAuth provider');
  const token = await getProviderToken();
  const hostname = await getWorkspaceHostname();

  // Create provider with fetch that always uses fresh token
  const provider = createOpenAI({
    baseURL: `${hostname}/serving-endpoints`,
    apiKey: token,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
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

// Server-side environment validation
if (!process.env.DATABRICKS_SERVING_ENDPOINT) {
  throw new Error(
    'Please set the DATABRICKS_SERVING_ENDPOINT environment variable to the name of an agent serving endpoint',
  );
}

const servingEndpoint = process.env.DATABRICKS_SERVING_ENDPOINT;
const databricksChatEndpoint = 'databricks-meta-llama-3-3-70b-instruct';

const databricksMiddleware: LanguageModelV2Middleware = {
  transformParams: async ({ params }) => {
    return {
      ...params,
      // Filter out the DATABRICKS_TOOL_CALL_ID tool
      tools: params.tools?.filter(
        (tool) => tool.name !== DATABRICKS_TOOL_CALL_ID,
      ),
    };
  },
  wrapGenerate: async ({ doGenerate }) => doGenerate(),
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    let lastChunk = null as LanguageModelV2StreamPart | null;
    const transformerStreamParts = composeDatabricksStreamPartTransformers(
      // Filter out raw chunks except the ones we want to keep
      applyDatabricksRawChunkStreamPartTransform,
      // Add text-start and text-end chunks
      applyDatabricksTextPartTransform,
      // Transform tool call stream parts
      applyDatabricksToolCallStreamPartTransform,
    );

    const deltaEndIds = new Set<string>();

    const transformStream = new TransformStream<
      LanguageModelV2StreamPart,
      LanguageModelV2StreamPart
    >({
      transform(chunk, controller) {
        try {
          // Apply transformation functions to the incoming chunks
          const { out } = transformerStreamParts([chunk], lastChunk);

          // Enqueue the transformed chunks with deduplication
          out.forEach((transformedChunk) => {
            if (
              transformedChunk.type === 'text-delta' ||
              transformedChunk.type === 'text-start' ||
              transformedChunk.type === 'text-end'
            ) {
              if (deltaEndIds.has(transformedChunk.id)) {
                // If we already have a delta end for this id, don't write it again
                return;
              }
            }
            if (transformedChunk.type === 'text-end') {
              /**
               * We register when a delta ends.
               * We rely on response.output_item.done chunks to display non streamed data
               * so we need to deduplicate them with their corresponding delta chunks.
               */
              deltaEndIds.add(transformedChunk.id);
            }
            controller.enqueue(transformedChunk);
          });

          // Update the last chunk
          lastChunk = out[out.length - 1] ?? lastChunk;
        } catch (error) {
          console.error('Error in databricksMiddleware transform:', error);
          console.error(
            'Stack trace:',
            error instanceof Error ? error.stack : 'No stack available',
          );
          // Continue processing by passing through the original chunk
          controller.enqueue(chunk);
        }
      },
      flush(controller) {
        try {
          // Finally, if there's a dangling text-delta, close it
          if (lastChunk?.type === 'text-delta') {
            controller.enqueue({ type: 'text-end', id: lastChunk.id });
          }
        } catch (error) {
          console.error('Error in databricksMiddleware flush:', error);
        }
      },
    });

    return {
      stream: stream.pipeThrough(transformStream),
      ...rest,
    };
  },
};

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
  const data = await response.json();
  const returnValue = {
    task: data.task as string | undefined,
    timestamp: Date.now(),
  };
  endpointDetailsCache.set(servingEndpoint, returnValue);
  return returnValue;
};

// Create a smart provider wrapper that handles OAuth initialization
interface SmartProvider {
  languageModel(id: string): Promise<any> | any;
}

class OAuthAwareProvider implements SmartProvider {
  private modelCache = new Map<string, { model: any; timestamp: number }>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  async languageModel(id: string): Promise<any> {
    const endpointDetails = await getEndpointDetails(servingEndpoint);
    // Check cache first
    const cached = this.modelCache.get(id);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      console.log(`Using cached model for ${id}`);
      return cached.model;
    }

    console.log(`Creating fresh model for ${id}`);

    // Get the OAuth provider
    const provider = await getOrCreateDatabricksProvider();

    let baseModel: LanguageModelV2;
    if (id === 'title-model' || id === 'artifact-model') {
      baseModel = provider.chat(databricksChatEndpoint);
    } else {
      if (endpointDetails.task?.includes('responses')) {
        baseModel = provider.responses(servingEndpoint);
      } else if (endpointDetails.task?.includes('chat')) {
        baseModel = provider.chat(servingEndpoint);
      } else {
        // Fall back to responses
        baseModel = provider.responses(servingEndpoint);
      }
    }

    let finalModel: LanguageModelV2;
    if (id === 'chat-model' || id === 'chat-model-reasoning') {
      finalModel = wrapLanguageModel({
        model: baseModel,
        middleware: [
          extractReasoningMiddleware({ tagName: 'think' }),
          databricksMiddleware,
        ],
      });
    } else {
      finalModel = baseModel;
    }

    // Cache the model
    this.modelCache.set(id, { model: finalModel, timestamp: Date.now() });
    return finalModel;
  }
}

// Create a singleton instance
const providerInstance = new OAuthAwareProvider();

// Export function that returns the provider (no server function needed here)
export function getDatabricksServerProvider() {
  return providerInstance;
}
