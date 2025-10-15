/**
 * Server-side provider that handles real authentication
 * This file should NOT be imported by client components
 */

import 'server-only';
import type { OAuthAwareProvider } from '../../databricks/providers/providers-server';

// For server-side usage, get the authenticated provider
async function getServerProvider() {
  const { getDatabricksServerProvider } = await import(
    '../../databricks/providers/providers-server'
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
