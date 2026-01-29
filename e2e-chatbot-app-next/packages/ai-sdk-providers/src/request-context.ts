/**
 * Context types and fetch factory for injecting user/conversation context
 * into Databricks Agent Endpoint requests.
 */

/**
 * Context to be passed with each request to Databricks Agent Endpoints.
 */
export interface DatabricksRequestContext {
  /** The conversation/chat ID (UUID) */
  conversationId: string;
  /** The user's email or ID */
  userId: string;
}

/**
 * Creates a fetch function that injects conversation and user context
 * into the request body for Databricks Agent Endpoints.
 *
 * The context is injected into the request body as:
 * ```json
 * {
 *   "databricks_options": {
 *     "conversation_id": "<chat-id>",
 *     "return_trace": true
 *   },
 *   "context": {
 *     "conversation_id": "<chat-id>",
 *     "user_id": "<user-email>"
 *   }
 * }
 * ```
 *
 * @param baseFetch - The base fetch function to wrap
 * @param context - The context containing conversation and user information
 * @param shouldInjectContext - Whether to inject context into the request
 * @returns A fetch function that injects context when appropriate
 */
export function createContextAwareFetch(
  baseFetch: typeof fetch,
  context: DatabricksRequestContext,
  shouldInjectContext: boolean,
): typeof fetch {
  if (!shouldInjectContext) {
    return baseFetch;
  }

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (!init?.body || typeof init.body !== 'string') {
      return baseFetch(input, init);
    }

    try {
      const body = JSON.parse(init.body);

      // Inject databricks_options with conversation_id and return_trace
      const enhancedBody = {
        ...body,
        databricks_options: {
          ...body.databricks_options,
          conversation_id: context.conversationId,
          return_trace: true,
        },
        context: {
          ...body.context,
          conversation_id: context.conversationId,
          user_id: context.userId,
        },
      };

      return baseFetch(input, {
        ...init,
        body: JSON.stringify(enhancedBody),
      });
    } catch {
      // If JSON parsing fails, pass through unchanged
      return baseFetch(input, init);
    }
  };
}

/**
 * Determines whether context should be injected based on endpoint type.
 *
 * Context is injected when:
 * 1. Using API_PROXY environment variable, OR
 * 2. Endpoint task type is 'agent/v2/chat' or 'agent/v1/responses'
 *
 * @param endpointTask - The task type of the serving endpoint (optional)
 * @returns Whether to inject context into requests
 */
export function shouldInjectContextForEndpoint(
  endpointTask: string | undefined,
): boolean {
  const API_PROXY = process.env.API_PROXY;

  if (API_PROXY) {
    return true;
  }

  return (
    endpointTask === 'agent/v2/chat' || endpointTask === 'agent/v1/responses'
  );
}
