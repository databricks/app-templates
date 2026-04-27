/**
 * Utility functions for request context handling.
 */

/**
 * Resolve the URL the AI SDK provider should POST to, or ``undefined`` when
 * the chatbot should talk directly to a Databricks serving endpoint.
 *
 * Resolution order:
 *   1. Explicit ``API_PROXY`` env var — caller knows best.
 *   2. ``DATABRICKS_SERVING_ENDPOINT`` set → direct-endpoint mode; no proxy.
 *   3. Advanced-template default → route via this Node server's own
 *      ``/invocations`` proxy.
 */
export function getApiProxyUrl(): string | undefined {
  if (process.env.API_PROXY) return process.env.API_PROXY;
  if (process.env.DATABRICKS_SERVING_ENDPOINT) return undefined;
  const port = process.env.CHAT_APP_PORT || process.env.PORT || '3000';
  return `http://localhost:${port}/invocations`;
}

/**
 * Determines whether context should be injected based on endpoint type.
 *
 * Context is injected when:
 * 1. The Express /invocations proxy is in play (explicit or inferred), OR
 * 2. Endpoint task type is 'agent/v2/chat' or 'agent/v1/responses'
 *
 * @param endpointTask - The task type of the serving endpoint (optional)
 * @returns Whether to inject context into requests
 */
export function shouldInjectContextForEndpoint(
  endpointTask: string | undefined,
): boolean {
  if (getApiProxyUrl()) {
    return true;
  }

  return (
    endpointTask === 'agent/v2/chat' || endpointTask === 'agent/v1/responses'
  );
}
