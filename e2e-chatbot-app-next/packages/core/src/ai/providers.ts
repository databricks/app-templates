/**
 * Server-side provider that handles real authentication
 * This file should NOT be imported by client components
 */

import type {
  OAuthAwareProvider,
  DatabricksRequestContext,
} from '@chat-template/ai-sdk-providers';

export type { DatabricksRequestContext } from '@chat-template/ai-sdk-providers';

// For server-side usage, get the authenticated provider
async function getServerProvider() {
  const { getDatabricksServerProvider } = await import(
    '@chat-template/ai-sdk-providers'
  );
  return getDatabricksServerProvider();
}

// Cache for server provider to avoid recreating it
let cachedServerProvider: OAuthAwareProvider | null = null;

// Export the main provider for server-side usage

export const myProvider = {
  // Server-side: use smart provider that handles OAuth
  async languageModel(id: string) {
    // Only call getServerProvider when actually needed (not during module init)
    if (!cachedServerProvider) {
      cachedServerProvider = await getServerProvider();
    }
    return await cachedServerProvider.languageModel(id);
  },

  /**
   * Creates a language model with request context (conversation_id, user_id).
   * Use this for chat endpoints that need to pass context to Databricks Agent Endpoints.
   */
  async languageModelWithContext(id: string, context: DatabricksRequestContext) {
    if (!cachedServerProvider) {
      cachedServerProvider = await getServerProvider();
    }
    return await cachedServerProvider.languageModelWithContext(id, context);
  },
};
