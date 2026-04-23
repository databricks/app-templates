/**
 * Utility functions for request context handling.
 */

import { getApiProxyUrl } from './api-proxy';

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
