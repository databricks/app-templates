/**
 * Utility functions for request context handling.
 */

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
