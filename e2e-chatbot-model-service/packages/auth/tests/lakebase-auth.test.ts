import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLakebaseToken, getDatabricksToken } from '@databricks/chatbot-auth';
import { getConnectionUrl } from '../../db/src/connection';

// Stub only HTTP; exercise the real auth helper, cache and connection URL builder.
test('Lakebase credentials refresh independently of workspace OAuth', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalEnv = { ...process.env };
  const binDir = await mkdtemp(join(tmpdir(), 'lakebase-cli-test-'));
  let now = 2_000_000_000_000;
  Date.now = () => now;
  process.env.DATABRICKS_HOST = 'https://workspace.example.com';
  process.env.DATABRICKS_CLIENT_ID = 'test-client';
  process.env.DATABRICKS_CLIENT_SECRET = 'test-secret';
  process.env.PGHOST = 'lakebase.example.com';
  process.env.PGDATABASE = 'test';
  process.env.PGUSER = 'app-principal';
  process.env.POSTGRES_URL = '';
  process.env.LAKEBASE_INSTANCE_NAME = '';
  process.env.DATABRICKS_WORKSPACE_ID = 'oauth-workspace';
  let expectedWorkspaceId = 'oauth-workspace';
  let credentialCalls = 0;
  let expectedHost = 'https://workspace.example.com';
  let expectedWorkspaceToken = 'workspace-oauth';
  let expectedInstance = 'bound-instance';
  let status = 200;
  let malformed = false;
  const requestIds = new Set<string>();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.endsWith('/oidc/v1/token')) {
      assert.equal(
        new Headers(init?.headers).get('X-Databricks-Workspace-Id'),
        expectedWorkspaceId,
      );
    }
    if (url.endsWith('/oidc/v1/token')) {
      return Response.json({
        access_token: 'workspace-oauth',
        expires_in: 3600,
      });
    }
    if (url.includes('/api/2.0/database/instances?')) {
      const secondPage = new URL(url).searchParams.has('page_token');
      return Response.json(
        secondPage
          ? {
              database_instances: [
                {
                  name: 'bound-instance',
                  read_write_dns: 'lakebase.example.com',
                },
              ],
            }
          : {
              database_instances: [
                { name: 'wrong-instance', read_write_dns: 'other.example.com' },
              ],
              next_page_token: 'next-page',
            },
      );
    }
    assert.equal(url, `${expectedHost}/api/2.0/database/credentials`);
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      `Bearer ${expectedWorkspaceToken}`,
    );
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.instance_names, [expectedInstance]);
    assert.match(body.request_id, /^[0-9a-f-]{36}$/);
    assert.equal(requestIds.has(body.request_id), false);
    requestIds.add(body.request_id);
    credentialCalls++;
    return Response.json(
      malformed
        ? {}
        : {
            token: `lakebase-${credentialCalls}`,
            expiration_time: new Date(now + 120_000).toISOString(),
          },
      { status },
    );
  };
  try {
    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => getLakebaseToken()),
    );
    assert.deepEqual(tokens, Array(5).fill('lakebase-1'));
    assert.equal(credentialCalls, 1);
    assert.equal(new URL(await getConnectionUrl()).password, 'lakebase-1');
    assert.equal(await getDatabricksToken(), 'workspace-oauth');
    now += 61_000;
    assert.equal(new URL(await getConnectionUrl()).password, 'lakebase-2');
    assert.equal(credentialCalls, 2);
    now += 61_000;
    status = 403;
    await assert.rejects(getLakebaseToken(), /403/);
    status = 200;
    malformed = true;
    await assert.rejects(getLakebaseToken(), /invalid or expired/);
    malformed = false;
    assert.equal(await getLakebaseToken(), 'lakebase-5');
    process.env.POSTGRES_URL = 'postgresql://localhost/test';
    const previousCalls = credentialCalls;
    now += 120_000;
    assert.equal(await getConnectionUrl(), process.env.POSTGRES_URL);
    assert.equal(credentialCalls, previousCalls);

    // The CLI is an external auth provider; this executable returns fixture credentials.
    await writeFile(
      join(binDir, 'databricks'),
      `#!/bin/sh
if [ "$2" = "describe" ]; then
  echo '{"username":"test@example.com","details":{"host":"https://cli-workspace.example.com","configuration":{"workspace_id":{"value":"cli-workspace"}}}}'
else
  echo '{"access_token":"cli-workspace-oauth","expires_in":3600}'
fi
`,
      { mode: 0o700 },
    );
    process.env.PATH = `${binDir}:${process.env.PATH}`;
    process.env.DATABRICKS_CLIENT_ID = '';
    process.env.DATABRICKS_CLIENT_SECRET = '';
    process.env.DATABRICKS_HOST = '';
    process.env.DATABRICKS_CONFIG_PROFILE = 'test-profile';
    process.env.DATABRICKS_WORKSPACE_ID = '';
    expectedWorkspaceId = 'cli-workspace';
    process.env.LAKEBASE_INSTANCE_NAME = 'cli-instance';
    process.env.POSTGRES_URL = '';
    expectedHost = 'https://cli-workspace.example.com';
    expectedWorkspaceToken = 'cli-workspace-oauth';
    expectedInstance = 'cli-instance';
    const cliUrl = new URL(await getConnectionUrl());
    assert.equal(decodeURIComponent(cliUrl.username), 'test@example.com');
    assert.equal(cliUrl.password, 'lakebase-6');
    now += 11 * 60_000;
    assert.equal(new URL(await getConnectionUrl()).password, 'lakebase-7');
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    process.env = originalEnv;
    await rm(binDir, { recursive: true, force: true });
  }
});
