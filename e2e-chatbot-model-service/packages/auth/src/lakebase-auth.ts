import { randomUUID } from 'node:crypto';
import { getHostUrl } from '@databricks/chatbot-utils';
import {
  getAuthMethod,
  getCachedCliHost,
  getCachedCliWorkspaceId,
  getDatabricksToken,
  getDatabricksUserIdentity,
} from './databricks-auth';

let cachedCredential: { token: string; expiresAt: number } | null = null;
let credentialRequest: Promise<string> | null = null;

let cachedInstance: { host: string; name: string } | null = null;

async function getLakebaseInstanceName(
  host: string,
  headers: Record<string, string>,
): Promise<string> {
  if (process.env.LAKEBASE_INSTANCE_NAME) {
    return process.env.LAKEBASE_INSTANCE_NAME;
  }
  const pgHost = process.env.PGHOST;
  if (!pgHost) {
    throw new Error('PGHOST is required to discover the Lakebase instance');
  }
  if (cachedInstance?.host === pgHost) {
    return cachedInstance.name;
  }
  // Resource bindings expose the database host, not the credential's instance name.
  let pageToken = '';
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (pageToken) query.set('page_token', pageToken);
    const response = await fetch(
      `${host}/api/2.0/database/instances?${query}`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(
        `Failed to resolve Lakebase instance: ${response.status}`,
      );
    }
    const page = (await response.json()) as {
      database_instances?: {
        name: string;
        read_write_dns?: string;
        read_only_dns?: string;
      }[];
      next_page_token?: string;
    };
    const instance = page.database_instances?.find(
      (candidate) =>
        candidate.read_write_dns === pgHost ||
        candidate.read_only_dns === pgHost,
    );
    if (instance?.name) {
      cachedInstance = { host: pgHost, name: instance.name };
      return instance.name;
    }
    pageToken = page.next_page_token || '';
  } while (pageToken);
  throw new Error(
    'No Lakebase instance matches PGHOST; set LAKEBASE_INSTANCE_NAME',
  );
}

async function generateLakebaseToken(): Promise<string> {
  // CLI auth discovers the workspace host from the selected profile.
  if (getAuthMethod() === 'cli') {
    await getDatabricksUserIdentity(!getCachedCliHost());
  }
  const cachedHost = getAuthMethod() === 'cli' ? getCachedCliHost() : null;
  const host = (cachedHost || getHostUrl()).replace(/\/$/, '');
  const workspaceToken = await getDatabricksToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${workspaceToken}`,
    'Content-Type': 'application/json',
  };
  const workspaceId =
    process.env.DATABRICKS_WORKSPACE_ID || getCachedCliWorkspaceId();
  if (workspaceId) {
    headers['X-Databricks-Workspace-Id'] = workspaceId;
  }
  const instanceName = await getLakebaseInstanceName(host, headers);
  const response = await fetch(`${host}/api/2.0/database/credentials`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      request_id: randomUUID(),
      instance_names: [instanceName],
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to generate Lakebase credential: ${response.status}`,
    );
  }

  const credential = (await response.json()) as {
    token?: string;
    expiration_time?: string;
  };
  const expiresAt = Date.parse(credential.expiration_time || '');
  if (
    !credential.token ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error('Lakebase returned an invalid or expired credential');
  }
  cachedCredential = { token: credential.token, expiresAt };
  return credential.token;
}

export async function getLakebaseToken(): Promise<string> {
  if (cachedCredential && Date.now() < cachedCredential.expiresAt - 60_000) {
    return cachedCredential.token;
  }
  // Concurrent queries share one refresh instead of minting competing credentials.
  if (!credentialRequest) {
    credentialRequest = generateLakebaseToken().finally(() => {
      credentialRequest = null;
    });
  }
  return credentialRequest;
}
