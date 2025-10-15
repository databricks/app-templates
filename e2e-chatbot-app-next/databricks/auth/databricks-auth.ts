import 'server-only';

/**
 * Consolidated Databricks authentication module
 * Server-only authentication for OAuth (service principal) and CLI-based OAuth U2M
 * Also handles user session management and SCIM API interactions
 */

import { getUserFromHeaders } from '@/databricks/db/queries';
import { isTestEnvironment } from '@/lib/constants';
import {
  getHostUrl,
  getHostDomain,
} from '@/databricks/utils/databricks-host-utils';

// ============================================================================
// Types
// ============================================================================

export type AuthMethod = 'oauth' | 'cli' | 'none';
export type UserType = 'regular'; // Simplified - no more guest users

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  preferredUsername?: string;
  type: UserType;
}

export interface AuthSession {
  user: AuthUser;
}

export interface ClientSession {
  user: {
    email: string;
    name?: string;
    preferredUsername?: string;
  } | null;
}

// ============================================================================
// Caching
// ============================================================================

// OAuth token caching
let oauthToken: string | null = null;
let oauthTokenExpiresAt = 0;

// CLI token caching
let cliToken: string | null = null;
let cliTokenExpiresAt = 0;

// CLI user identity caching
let cliUserIdentity: string | null = null;
let cliUserIdentityExpiresAt = 0;
const USER_IDENTITY_CACHE_DURATION = 30 * 60 * 1000; // Cache for 30 minutes

// SCIM user data caching (for local development)
let cachedScimUser: any = null;
let cacheExpiry = 0;

// ============================================================================
// Authentication Method Detection
// ============================================================================

/**
 * Determine which authentication method to use
 */
export function getAuthMethod(): AuthMethod {
  // Check for OAuth (service principal) credentials
  if (shouldUseOAuth()) {
    return 'oauth';
  }

  // Check for CLI-based authentication
  if (shouldUseCLIAuth()) {
    return 'cli';
  }

  return 'none';
}

/**
 * Check if we should use OAuth authentication
 */
export function shouldUseOAuth(): boolean {
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;

  try {
    getHostDomain(); // This will throw if DATABRICKS_HOST is not set
    return !!(clientId && clientSecret);
  } catch {
    return false;
  }
}

/**
 * Check if we should use CLI-based OAuth U2M authentication
 */
export function shouldUseCLIAuth(): boolean {
  const configProfile = process.env.DATABRICKS_CONFIG_PROFILE;
  const databricksHost = process.env.DATABRICKS_HOST;

  // CLI auth is available if we have a profile or a host
  return !!(configProfile || databricksHost);
}

/**
 * Check if any Databricks authentication is available
 */
export function isAuthAvailable(): boolean {
  return getAuthMethod() !== 'none';
}

/**
 * Get authentication method description for logging
 */
export function getAuthMethodDescription(): string {
  const method = getAuthMethod();

  switch (method) {
    case 'oauth':
      return 'OAuth (service principal)';
    case 'cli':
      return 'CLI-based OAuth U2M';
    case 'none':
      return 'No authentication configured';
    default:
      return `Unknown method: ${method}`;
  }
}

/**
 * Get the cached CLI host URL
 * Returns null if no CLI host is cached or if cache has expired
 */
export function getCachedCliHost(): string | null {
  if (cliHostCache && Date.now() < cliHostCacheTime + CLI_HOST_CACHE_DURATION) {
    return cliHostCache.startsWith('https://')
      ? cliHostCache
      : `https://${cliHostCache}`;
  }
  return null;
}

// ============================================================================
// OAuth Authentication (Service Principal)
// ============================================================================

/**
 * Get a fresh Databricks OAuth token, with caching
 */
export async function getDatabricksOAuthToken(): Promise<string> {
  // Check if we have a valid cached token
  if (oauthToken && Date.now() < oauthTokenExpiresAt) {
    return oauthToken;
  }

  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  const hostUrl = getHostUrl();

  if (!clientId || !clientSecret || !hostUrl) {
    throw new Error(
      'OAuth service principal authentication requires DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, and DATABRICKS_HOST environment variables',
    );
  }

  const tokenUrl = `${hostUrl.replace(/\/$/, '')}/oidc/v1/token`;
  const body = 'grant_type=client_credentials&scope=all-apis';

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get OAuth token: ${response.status} ${errorText}`,
    );
  }

  const data = await response.json();
  const accessToken = data.access_token;

  if (!accessToken) {
    throw new Error('No access token received from OAuth response');
  }

  oauthToken = accessToken;

  // Set expiration with a buffer (10 minutes or 20% of lifetime, whichever is smaller)
  const expiresInSeconds = data.expires_in || 3600;
  const bufferSeconds = Math.min(600, Math.floor(expiresInSeconds * 0.2));
  oauthTokenExpiresAt = Date.now() + (expiresInSeconds - bufferSeconds) * 1000;

  console.log(
    `[OAuth] Token acquired, expires in ${expiresInSeconds}s, will refresh in ${expiresInSeconds - bufferSeconds}s`,
  );

  return accessToken;
}

// ============================================================================
// CLI Authentication (OAuth U2M)
// ============================================================================

// Cache for CLI host information
let cliHostCache: string | null = null;
let cliHostCacheTime = 0;
const CLI_HOST_CACHE_DURATION = 10 * 60 * 1000; // Cache for 10 minutes

/**
 * Get the current user's identity using the Databricks CLI
 */
export async function getDatabricksUserIdentity(): Promise<string> {
  // Check if we have a valid cached identity
  if (cliUserIdentity && Date.now() < cliUserIdentityExpiresAt) {
    return cliUserIdentity;
  }

  const { spawnWithOutput } = await import('@/databricks/utils/subprocess');

  // Get options from environment
  const configProfile = process.env.DATABRICKS_CONFIG_PROFILE;
  let host = process.env.DATABRICKS_HOST;

  // Use cached host if available, otherwise fall back to env var
  if (cliHostCache && Date.now() < cliHostCacheTime + CLI_HOST_CACHE_DURATION) {
    // Remove protocol if present and trailing slash
    host = cliHostCache.replace(/^https?:\/\//, '').replace(/\/$/, '');
  } else if (host) {
    const { getHostDomain } = await import(
      '@/databricks/utils/databricks-host-utils'
    );
    host = getHostDomain(host);
  }

  const args = ['auth', 'describe', '--output', 'json'];
  if (configProfile) {
    args.push('--profile', configProfile);
  }
  if (host) {
    args.push('--host', host);
  }

  try {
    const stdout = await spawnWithOutput('databricks', args, {
      errorMessagePrefix: 'Databricks CLI auth describe failed',
    });

    const authData = JSON.parse(stdout);
    const username = authData.username;

    if (!username) {
      throw new Error('No username found in CLI auth describe output');
    }

    const responseHost = authData.details?.host;

    // Cache user identity
    cliUserIdentity = username;
    cliUserIdentityExpiresAt = Date.now() + USER_IDENTITY_CACHE_DURATION;

    // Cache host information if available
    if (responseHost) {
      cliHostCache = responseHost;
      cliHostCacheTime = Date.now();
      console.log(`[CLI Auth] Host cached: ${responseHost}`);
    }

    console.log(`[CLI Auth] User identity acquired: ${username}`);
    return username;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Failed to parse')) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('exit code')) {
      throw error;
    }
    throw new Error(`Failed to execute Databricks CLI auth describe: ${error}`);
  }
}

/**
 * Get a token using the Databricks CLI OAuth U2M authentication
 */
export async function getDatabricksCliToken(): Promise<string> {
  // Check if we have a valid cached token
  if (cliToken && Date.now() < cliTokenExpiresAt) {
    return cliToken;
  }

  const { spawnWithOutput } = await import('@/databricks/utils/subprocess');

  // Get options from environment
  const configProfile = process.env.DATABRICKS_CONFIG_PROFILE;
  let host = process.env.DATABRICKS_HOST;

  // Use cached host if available, otherwise fall back to env var
  if (cliHostCache && Date.now() < cliHostCacheTime + CLI_HOST_CACHE_DURATION) {
    // Remove protocol if present and trailing slash
    host = cliHostCache.replace(/^https?:\/\//, '').replace(/\/$/, '');
  } else if (host) {
    const { getHostDomain } = await import(
      '@/databricks/utils/databricks-host-utils'
    );
    host = getHostDomain(host);
  }

  const args = ['auth', 'token'];
  if (configProfile) {
    args.push('--profile', configProfile);
  }
  if (host) {
    args.push('--host', host);
  }

  try {
    const stdout = await spawnWithOutput('databricks', args, {
      errorMessagePrefix:
        'Databricks CLI auth token failed\nMake sure you have run "databricks auth login" first.',
    });

    const tokenData = JSON.parse(stdout);
    if (!tokenData.access_token) {
      throw new Error('No access_token found in CLI output');
    }

    const expiresIn = tokenData.expires_in || 3600;

    cliToken = tokenData.access_token;
    // Set expiration with a 5-minute buffer to avoid using near-expired tokens
    const bufferSeconds = 300;
    cliTokenExpiresAt = Date.now() + (expiresIn - bufferSeconds) * 1000;

    console.log(
      `[CLI Auth] Token acquired, expires in ${expiresIn}s, ` +
        `will refresh in ${expiresIn - bufferSeconds}s`,
    );
    return tokenData.access_token;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Failed to parse')) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('exit code')) {
      throw error;
    }
    throw new Error(
      `Failed to execute Databricks CLI: ${error}\nMake sure the Databricks CLI is installed and in your PATH.`,
    );
  }
}

// ============================================================================
// Main Token Management
// ============================================================================

/**
 * Get a Databricks authentication token using the best available method
 */
export async function getDatabricksToken(): Promise<string> {
  const method = getAuthMethod();

  switch (method) {
    case 'oauth':
      return getDatabricksOAuthToken();
    case 'cli':
      return getDatabricksCliToken();
    case 'none':
      throw new Error(
        'No Databricks authentication configured. Please set one of:\n' +
          '- DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET + DATABRICKS_HOST (OAuth)\n' +
          '- DATABRICKS_CONFIG_PROFILE or DATABRICKS_HOST (CLI auth - run "databricks auth login" first)',
      );
    default:
      throw new Error(`Unknown authentication method: ${method}`);
  }
}

/**
 * Get the database username based on the authentication method
 * For OAuth (service principal): use PGUSER environment variable
 * For CLI auth (user): use the current user's identity
 */
export async function getDatabaseUsername(): Promise<string> {
  const method = getAuthMethod();

  switch (method) {
    case 'oauth': {
      // For OAuth service principal, use the configured PGUSER
      const pgUser = process.env.PGUSER;
      if (!pgUser) {
        throw new Error(
          'PGUSER environment variable must be set for OAuth authentication',
        );
      }
      return pgUser;
    }

    case 'cli':
      // For CLI auth, use the current user's identity
      console.log(`[CLI Auth] Using user identity for database role`);
      return await getDatabricksUserIdentity();

    case 'none':
      throw new Error('No Databricks authentication configured');

    default:
      throw new Error(`Unknown authentication method: ${method}`);
  }
}

// ============================================================================
// User Session Management
// ============================================================================

/**
 * Get current user from Databricks SCIM API (for local development)
 */
async function getDatabricksCurrentUser(): Promise<any> {
  // Check cache first
  if (cachedScimUser && Date.now() < cacheExpiry) {
    console.log(
      '[getDatabricksCurrentUser] Using cached SCIM user data (expires in',
      Math.floor((cacheExpiry - Date.now()) / 1000),
      'seconds)',
    );
    return cachedScimUser;
  }

  console.log('[getDatabricksCurrentUser] Cache miss - fetching from SCIM API');

  // Determine auth method and handle CLI auth specially
  const method = getAuthMethod();
  let hostUrl: string;
  let token: string;

  if (method === 'cli') {
    // For CLI auth, we need to get user identity first to cache the host
    await getDatabricksUserIdentity(); // This will cache the host

    // Now get the host from cache or fallback to env var
    if (cliHostCache) {
      hostUrl = cliHostCache.startsWith('https://')
        ? cliHostCache
        : `https://${cliHostCache}`;
    } else {
      // Fallback to original method if CLI didn't provide host
      hostUrl = getHostUrl();
    }

    // Get token (this will also use the cached host)
    token = await getDatabricksCliToken();
  } else {
    // For OAuth, use the original method
    hostUrl = getHostUrl();
    token = await getDatabricksToken();
  }
  const authHeader = `Bearer ${token}`;

  // Call SCIM API to get current user
  const scimUrl = `${hostUrl}/api/2.0/preview/scim/v2/Me`;
  console.log(
    '[getDatabricksCurrentUser] Fetching user from SCIM API:',
    scimUrl,
  );

  const scimResponse = await fetch(scimUrl, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  });

  if (!scimResponse.ok) {
    const errorText = await scimResponse.text();
    throw new Error(
      `Failed to get SCIM user: ${scimResponse.status} ${errorText}`,
    );
  }

  const scimUser = await scimResponse.json();
  console.log('[getDatabricksCurrentUser] SCIM user retrieved:', {
    id: scimUser.id,
    userName: scimUser.userName,
    displayName: scimUser.displayName,
    emails: scimUser.emails,
  });

  // Cache for 30 minutes in development (longer since user won't change)
  cachedScimUser = scimUser;
  cacheExpiry = Date.now() + 30 * 60 * 1000;
  console.log(
    '[getDatabricksCurrentUser] Cached SCIM user data for 30 minutes',
  );

  return scimUser;
}

/**
 * Main authentication function for all environments
 */
export async function getAuthSession(
  request?: Request,
): Promise<AuthSession | null> {
  try {
    // In test environments, short-circuit auth using forwarded headers or defaults
    if (isTestEnvironment) {
      const fwdUser =
        request?.headers.get('X-Forwarded-User') ?? 'test-user-id';
      const fwdEmail =
        request?.headers.get('X-Forwarded-Email') ?? 'test@example.com';
      const fwdName =
        request?.headers.get('X-Forwarded-Preferred-Username') ?? 'test-user';

      const mockReq = {
        headers: new Headers([
          ['X-Forwarded-User', fwdUser],
          ['X-Forwarded-Email', fwdEmail],
          ['X-Forwarded-Preferred-Username', fwdName],
        ]),
      } as Request;

      const user = await getUserFromHeaders(mockReq);

      return {
        user: {
          id: user.id,
          email: user.email || fwdEmail,
          name: fwdName,
          preferredUsername: fwdName,
          type: 'regular',
        },
      };
    }
    // Check for Databricks Apps headers (production)
    if (request?.headers.get('X-Forwarded-User')) {
      console.log('[getAuthSession] Using Databricks Apps headers');

      const forwardedUser = request.headers.get('X-Forwarded-User');
      const forwardedEmail = request.headers.get('X-Forwarded-Email');
      const forwardedPreferredUsername = request.headers.get(
        'X-Forwarded-Preferred-Username',
      );

      // Get user from headers
      const user = await getUserFromHeaders(request);

      return {
        user: {
          id: user.id,
          email: user.email || forwardedEmail || '',
          name: forwardedPreferredUsername || forwardedUser || undefined,
          preferredUsername: forwardedPreferredUsername || undefined,
          type: 'regular',
        },
      };
    }

    // Local development - use SCIM API
    console.log('[getAuthSession] Using SCIM API for local development');

    const scimUser = await getDatabricksCurrentUser();

    // Extract email from SCIM response
    const primaryEmail =
      scimUser.emails?.find((e: any) => e.primary)?.value ||
      scimUser.emails?.[0]?.value ||
      `${scimUser.userName}@databricks.com`;

    // Create mock request for user creation
    const mockRequest = {
      headers: {
        get: (name: string) => {
          if (name === 'X-Forwarded-User') return scimUser.id;
          if (name === 'X-Forwarded-Email') return primaryEmail;
          if (name === 'X-Forwarded-Preferred-Username')
            return scimUser.userName;
          return null;
        },
        has: (name: string) => {
          return [
            'X-Forwarded-User',
            'X-Forwarded-Email',
            'X-Forwarded-Preferred-Username',
          ].includes(name);
        },
      },
    } as Request;

    // Get or create user in database
    const user = await getUserFromHeaders(mockRequest);

    return {
      user: {
        id: user.id,
        email: user.email || primaryEmail,
        name: scimUser.displayName || scimUser.userName,
        preferredUsername: scimUser.userName,
        type: 'regular',
      },
    };
  } catch (error) {
    console.error('[getAuthSession] Failed to get session:', error);
    return null;
  }
}

/**
 * Get auth session for Next.js page components (using headers from next/headers)
 */
export async function getAuthSessionFromHeaders(
  headersList: Headers,
): Promise<AuthSession | null> {
  // Create a mock request from Next.js headers
  const mockRequest = {
    headers: headersList,
  } as Request;

  return getAuthSession(mockRequest);
}
