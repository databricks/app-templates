import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createWorkspaceClient } from '@databricks/appkit';
import { ensureJobViewPermission } from '../server/jobPermissions.ts';

async function workspace(t, options = {}) {
  const state = { permissions: { access_control_list: options.acl ?? [] }, requests: [] };
  // Keep the real AppKit/SDK auth and HTTP transport; only the remote Jobs service is replaced.
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    state.requests.push({ method: req.method, path: req.url, body, headers: req.headers });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'PATCH') {
      if (options.redirect) {
        res.writeHead(307, { Location: '/unexpected' });
        res.end('{}');
        return;
      }
      if (options.patchStatus) {
        res.writeHead(options.patchStatus);
        res.end(JSON.stringify({ error_code: 'PERMISSION_DENIED', message: 'Permission update failed' }));
        return;
      }
      if (!options.ignoreUpdate) {
        state.permissions.access_control_list.push(...JSON.parse(body).access_control_list.map(
          ({ permission_level, ...principal }) => ({ ...principal, all_permissions: [{ permission_level }] }),
        ));
      }
    } else if (options.readStatus || (options.confirmationStatus && state.requests.length > 1)) {
      res.writeHead(options.readStatus ?? options.confirmationStatus);
      res.end(JSON.stringify({ error_code: 'PERMISSION_DENIED', message: 'Permission read failed' }));
      return;
    }
    res.end(JSON.stringify(state.permissions));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const client = createWorkspaceClient({ host: `http://127.0.0.1:${server.address().port}`, token: 'test-only' });
  return { client, state };
}

test('sends and confirms an authenticated incremental PATCH through the real SDK client', async (t) => {
  const initialAcl = [
    { user_name: 'author@example.com', all_permissions: [{ permission_level: 'IS_OWNER' }] },
    { service_principal_name: 'app-id', all_permissions: [{ permission_level: 'CAN_MANAGE' }] },
    { group_name: 'existing-viewers', all_permissions: [{ permission_level: 'CAN_VIEW' }] },
  ];
  const { client, state } = await workspace(t, { acl: structuredClone(initialAcl) });
  await ensureJobViewPermission(client, '100', 'Alice@Example.com');
  assert.deepEqual(state.requests.map(({ method }) => method), ['GET', 'PATCH', 'GET']);
  const patch = state.requests[1];
  assert.equal(patch.path, '/api/2.0/permissions/jobs/100');
  assert.equal(patch.headers.authorization, 'Bearer test-only');
  assert.equal(patch.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(patch.body), {
    access_control_list: [{ user_name: 'Alice@Example.com', permission_level: 'CAN_VIEW' }],
  });
  assert.deepEqual(state.permissions.access_control_list, [
    ...initialAcl,
    { user_name: 'Alice@Example.com', all_permissions: [{ permission_level: 'CAN_VIEW' }] },
  ]);
  await ensureJobViewPermission(client, '100', 'alice@example.com');
  assert.equal(state.requests.filter(({ method }) => method === 'PATCH').length, 1);
});

for (const [level, inherited] of [
  ['CAN_VIEW', false], ['CAN_MANAGE_RUN', false], ['CAN_MANAGE', false], ['IS_OWNER', false], ['CAN_VIEW', true],
]) {
  test(`retains existing ${inherited ? 'inherited ' : ''}${level} permissions over HTTP`, async (t) => {
    const acl = [{ user_name: 'ALICE@EXAMPLE.COM', all_permissions: [{ permission_level: level, inherited }] }];
    const { client, state } = await workspace(t, { acl: structuredClone(acl) });
    await ensureJobViewPermission(client, '100', 'alice@example.com');
    assert.deepEqual(state.requests.map(({ method }) => method), ['GET']);
    assert.deepEqual(state.permissions.access_control_list, acl);
  });
}

for (const status of [403, 429, 503]) {
  test(`does not retry a failed permission PATCH (HTTP ${status})`, async (t) => {
    const { client, state } = await workspace(t, { patchStatus: status });
    await assert.rejects(ensureJobViewPermission(client, '100', 'alice@example.com'), new RegExp(`HTTP ${status}`));
    assert.deepEqual(state.requests.map(({ method }) => method), ['GET', 'PATCH']);
    assert.deepEqual(state.permissions.access_control_list, []);
  });
}

test('rejects an accepted PATCH that does not persist the user grant', async (t) => {
  const { client, state } = await workspace(t, { ignoreUpdate: true });
  await assert.rejects(ensureJobViewPermission(client, '100', 'alice@example.com'), /did not confirm your permission/);
  assert.deepEqual(state.requests.map(({ method }) => method), ['GET', 'PATCH', 'GET']);
});

for (const [phase, options, methods] of [
  ['initial', { readStatus: 403 }, ['GET']],
  ['confirmation', { confirmationStatus: 403 }, ['GET', 'PATCH', 'GET']],
]) {
  test(`rejects a failed ${phase} ACL read`, async (t) => {
    const { client, state } = await workspace(t, options);
    await assert.rejects(ensureJobViewPermission(client, '100', 'alice@example.com'), /Permission read failed/);
    assert.deepEqual(state.requests.map(({ method }) => method), methods);
  });
}

test('refuses to redirect an authenticated permission write', async (t) => {
  const { client, state } = await workspace(t, { redirect: true });
  await assert.rejects(ensureJobViewPermission(client, '100', 'alice@example.com'));
  assert.deepEqual(state.requests.map(({ method }) => method), ['GET', 'PATCH']);
  assert.ok(state.requests.every(({ path }) => path === '/api/2.0/permissions/jobs/100'));
});
