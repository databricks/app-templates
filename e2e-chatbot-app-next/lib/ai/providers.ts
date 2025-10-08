/**
 * Server-side provider that handles real authentication
 * This file should NOT be imported by client components
 */

import 'server-only';
import { customProvider } from 'ai';
import { isTestEnvironment } from '../constants';

// For server-side usage, get the authenticated provider
async function getServerProvider() {
  const { getDatabricksServerProvider } = await import(
    '../../databricks/providers/providers-server'
  );
  return getDatabricksServerProvider();
}

// Cache for server provider to avoid recreating it
let cachedServerProvider: any = null;

// Export the main provider for server-side usage
export const myProvider = isTestEnvironment
  ? (() => {
      const {
        artifactModel,
        chatModel,
        reasoningModel,
        titleModel,
      } = require('./models.mock');
      return customProvider({
        languageModels: {
          'chat-model': chatModel,
          'chat-model-reasoning': reasoningModel,
          'title-model': titleModel,
          'artifact-model': artifactModel,
        },
      });
    })()
  : {
      // Server-side: use smart provider that handles OAuth
      async languageModel(id: string) {
        // Only call getServerProvider when actually needed (not during module init)
        if (!cachedServerProvider) {
          cachedServerProvider = await getServerProvider();
        }
        return await cachedServerProvider.languageModel(id);
      },
    };
