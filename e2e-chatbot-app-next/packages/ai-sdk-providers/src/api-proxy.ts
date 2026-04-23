/**
 * Single source of truth for the "route chat through the local /invocations
 * proxy" decision. Returns the URL the AI SDK provider should POST to, or
 * undefined when the chatbot should talk directly to a Databricks serving
 * endpoint.
 *
 * Resolution order:
 *   1. Explicit ``API_PROXY`` env var — caller knows best.
 *   2. ``DATABRICKS_SERVING_ENDPOINT`` set — direct-endpoint mode; no proxy.
 *   3. Advanced-template default — assume a local FastAPI agent is reachable
 *      via this Node server's own /invocations route, and route there.
 */
export function getApiProxyUrl(): string | undefined {
  if (process.env.API_PROXY) return process.env.API_PROXY;
  if (process.env.DATABRICKS_SERVING_ENDPOINT) return undefined;
  const port = process.env.CHAT_APP_PORT || process.env.PORT || '3000';
  return `http://localhost:${port}/invocations`;
}
