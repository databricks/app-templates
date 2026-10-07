import type { LanguageModelV3 } from '@ai-sdk/provider';

import { getHostUrl } from '@chat-template/utils';
// Import auth module directly
import {
  getAuthMethod,
  getDatabricksUserIdentity,
  getCachedCliHost,
} from '@chat-template/auth';
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { getModelServiceLanguageModel } from './model-service-provider';

// Cache the workspace hostname once resolved
let cachedWorkspaceHostname: string | null = null;

// Get workspace hostname with one-time resolution and caching
export async function getWorkspaceHostname(): Promise<string> {
  if (cachedWorkspaceHostname) {
    return cachedWorkspaceHostname;
  }

  try {
    // Use the same approach as getDatabricksCurrentUser to get hostname
    const authMethod = getAuthMethod();

    if (authMethod === 'cli') {
      // For CLI auth, we need to call getDatabricksUserIdentity which handles hostname resolution
      // This will trigger the CLI auth flow and properly cache the host
      await getDatabricksUserIdentity();

      // After CLI auth succeeds, get the hostname from the CLI cache
      const cliHost = getCachedCliHost();
      if (cliHost) {
        cachedWorkspaceHostname = cliHost;
        return cachedWorkspaceHostname;
      } else {
        throw new Error(
          'CLI authentication succeeded but hostname was not cached',
        );
      }
    } else {
      // For OAuth, use the standard method
      cachedWorkspaceHostname = getHostUrl();
      return cachedWorkspaceHostname;
    }
  } catch (error) {
    throw new Error(
      `Unable to determine Databricks workspace hostname: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

// Create a smart provider wrapper that handles OAuth initialization
interface SmartProvider {
  languageModel(id: string): Promise<LanguageModelV3>;
}

export class OAuthAwareProvider implements SmartProvider {
  private modelCache = new Map<
    string,
    { model: LanguageModelV3; timestamp: number }
  >();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  async languageModel(id: string): Promise<LanguageModelV3> {
    // Check cache first
    const cached = this.modelCache.get(id);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      console.log(`Using cached model for ${id}`);
      return cached.model;
    }

    console.log(`Creating model-service model for ${id}`);
    const model = await getModelServiceLanguageModel();

    const wrappedModel = wrapLanguageModel({
      model,
      middleware: [extractReasoningMiddleware({ tagName: 'think' })],
    });

    // Cache the model
    this.modelCache.set(id, { model: wrappedModel, timestamp: Date.now() });
    return wrappedModel;
  }
}

// Create a singleton instance
const providerInstance = new OAuthAwareProvider();

// Export function that returns the provider (no server function needed here)
export function getDatabricksServerProvider() {
  return providerInstance;
}
