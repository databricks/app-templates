import type { WorkspaceClient } from '@databricks/appkit';

type JobPermissionClient = Pick<WorkspaceClient, 'jobs' | 'config'>;
type JobPermissions = Awaited<ReturnType<JobPermissionClient['jobs']['getPermissions']>>;

function canViewJob(permissions: JobPermissions, userName: string): boolean {
  return permissions.access_control_list?.some(
    (entry) =>
      entry.user_name?.toLowerCase() === userName.toLowerCase() &&
      entry.all_permissions?.some((permission) => permission.permission_level !== undefined),
  ) ?? false;
}

export async function ensureJobViewPermission(client: JobPermissionClient, jobId: string, userName: string) {
  const request = { job_id: jobId };
  if (canViewJob(await client.jobs.getPermissions(request), userName)) return;

  // sdk-experimental 0.17.0 drops PATCH payloads; use its auth with a single native HTTP write.
  const host = await client.config.getHost();
  const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
  await client.config.authenticate(headers);
  if (client.config.hostType() === 'unifiedHost' && client.config.workspaceId) {
    headers.set('X-Databricks-Org-Id', client.config.workspaceId);
  }
  const response = await fetch(new URL(`/api/2.0/permissions/jobs/${encodeURIComponent(jobId)}`, host), {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ access_control_list: [{ user_name: userName, permission_level: 'CAN_VIEW' }] }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const details: unknown = await response.json().catch(() => undefined);
    const message = details !== null && typeof details === 'object' &&
      'message' in details && typeof details.message === 'string' ? `: ${details.message}` : '';
    throw new Error(`Could not grant access to view Job runs (HTTP ${response.status})${message}`);
  }
  await response.body?.cancel();

  if (!canViewJob(await client.jobs.getPermissions(request), userName)) {
    throw new Error('The Job did not confirm your permission to view its runs. Try again or contact the App owner.');
  }
}
