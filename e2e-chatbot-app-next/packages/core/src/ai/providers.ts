/**
 * Server-side provider that handles real authentication
 * This file should NOT be imported by client components
 */

import type { OAuthAwareProvider } from '@chat-template/ai-sdk-providers';

export {
  CONTEXT_HEADER_CONVERSATION_ID,
  CONTEXT_HEADER_USER_ID,
} from '@chat-template/ai-sdk-providers';

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
};
