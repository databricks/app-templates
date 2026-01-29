/**
 * Request context using AsyncLocalStorage for injecting user/conversation context
 * into Databricks Agent Endpoint requests.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Context to be passed with each request to Databricks Agent Endpoints.
 */
export interface DatabricksRequestContext {
  /** The conversation/chat ID (UUID) */
  conversationId: string;
  /** The user's email or ID */
  userId: string;
}

const requestContextStorage = new AsyncLocalStorage<DatabricksRequestContext>();

/**
 * Gets the current request context from AsyncLocalStorage.
 * Returns undefined if not within a runWithRequestContext call.
 */
export function getRequestContext(): DatabricksRequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Runs a function with the given request context available via getRequestContext().
 *
 * @param context - The context containing conversation and user information
 * @param fn - The function to run with the context
 * @returns The return value of the function
 */
export function runWithRequestContext<T>(
  context: DatabricksRequestContext,
  fn: () => T,
): T {
  return requestContextStorage.run(context, fn);
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
