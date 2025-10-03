/**
 * Node.js-compatible Databricks authentication for build-time scripts
 * This module does NOT import 'server-only' and can be used with tsx
 */

import { spawnWithOutput } from '@/databricks/utils/subprocess';
import { getHostUrl } from '../utils/databricks-host-utils';

export function getAuthMethodDescription(): string {
  const method = getAuthMethod();
  switch (method) {
    case 'oauth':
      return 'OAuth service principal';
    case 'cli':
      return 'CLI OAuth U2M';
    default:
      return 'Unknown';
  }
}

export function getAuthMethod(): 'oauth' | 'cli' {
  // Check if OAuth service principal credentials are available
  if (
    process.env.DATABRICKS_CLIENT_ID &&
    process.env.DATABRICKS_CLIENT_SECRET
  ) {
    return 'oauth';
  }

  // Default to CLI authentication
  return 'cli';
}

export async function getDatabricksToken(): Promise<string> {
  const method = getAuthMethod();

  switch (method) {
    case 'oauth':
      return getDatabricksOAuthToken();
    case 'cli':
      return getDatabricksCliToken();
    default:
      throw new Error(`Unsupported auth method: ${method}`);
  }
}

export async function getDatabaseUsername(): Promise<string> {
  const method = getAuthMethod();

  switch (method) {
    case 'oauth': {
      // For OAuth service principal, use the configured PGUSER
      const pgUser = process.env.PGUSER;
      if (!pgUser) {
        throw new Error(
          'PGUSER environment variable required for OAuth service principal auth',
        );
      }
      return pgUser;
    }
    case 'cli':
      return getDatabricksUserIdentity();
    default:
      throw new Error(`Unsupported auth method: ${method}`);
  }
}

async function getDatabricksOAuthToken(): Promise<string> {
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  const hostUrl = getHostUrl();

  if (!clientId || !clientSecret || !hostUrl) {
    throw new Error(
      'OAuth service principal authentication requires DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, and DATABRICKS_HOST environment variables',
    );
  }

  const tokenUrl = `${hostUrl.replace(/\/$/, '')}/oidc/v1/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'all-apis',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `OAuth token request failed: ${response.status} ${response.statusText}`,
    );
  }

  const tokenData = await response.json();
  return tokenData.access_token;
}

async function getDatabricksCliToken(): Promise<string> {
  const configProfile = process.env.DATABRICKS_CONFIG_PROFILE;
  let host = process.env.DATABRICKS_HOST;

  if (host) {
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

  const stdout = await spawnWithOutput('databricks', args, {
    errorMessagePrefix:
      'Databricks CLI auth token failed\nMake sure you have run "databricks auth login" first.',
  });

  const tokenData = JSON.parse(stdout);
  if (!tokenData.access_token) {
    throw new Error('No access_token found in CLI output');
  }

  return tokenData.access_token;
}

async function getDatabricksUserIdentity(): Promise<string> {
  const configProfile = process.env.DATABRICKS_CONFIG_PROFILE;
  let host = process.env.DATABRICKS_HOST;

  if (host) {
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

  const stdout = await spawnWithOutput('databricks', args, {
    errorMessagePrefix: 'Databricks CLI auth describe failed',
  });

  const authData = JSON.parse(stdout);
  if (!authData.username) {
    throw new Error('No username found in CLI auth describe output');
  }

  return authData.username;
}
