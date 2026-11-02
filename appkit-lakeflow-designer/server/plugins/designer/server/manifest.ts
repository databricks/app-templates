import { appManifestSchema, type AppManifest } from '../shared/appManifest';
import { isRecord, nonEmptyString } from '../shared/values';

// The publisher keeps the manifest beside the runner, outside publicly served App assets.
const MANIFEST_FILENAME = 'designerApp.json';

export function jobNotebookPaths(job: unknown): (string | undefined)[] {
  const tasks = isRecord(job) && isRecord(job.settings) && Array.isArray(job.settings.tasks) ? job.settings.tasks : [];
  return tasks.map((task: unknown) =>
    isRecord(task) && isRecord(task.notebook_task) ? nonEmptyString(task.notebook_task.notebook_path) : undefined
  );
}

export function createManifestLoader({
  jobId,
  readJob,
  readWorkspaceJson,
  report,
}: {
  jobId: string | undefined;
  readJob: () => Promise<unknown>;
  readWorkspaceJson: (path: string, query: Record<string, string>) => Promise<unknown>;
  report: (...args: unknown[]) => void;
}) {
  // Polled run-status reads reuse the cached manifest; other routes pass forceFresh, so a republish
  // takes effect without a redeploy.
  let cachedManifest: AppManifest | undefined;
  const loadManifest = async (forceFresh = false): Promise<AppManifest | undefined> => {
    if (!forceFresh && cachedManifest !== undefined) {
      return cachedManifest;
    }
    const manifest = await readManifest();
    // A failed fresh read must not keep stale execution or file policies active.
    if (manifest !== undefined || forceFresh) {
      cachedManifest = manifest;
    }
    return manifest;
  };

  function manifestFolderFromNotebookPath(notebookPath: string): string {
    const lastSlash = notebookPath.lastIndexOf('/');
    return lastSlash <= 0 ? notebookPath : notebookPath.slice(0, lastSlash);
  }

  // All immutable runner revisions share the App folder, so resolve it from the bound Job once.
  let cachedManifestFolder: string | undefined;

  async function resolveManifestFolder(): Promise<string | undefined> {
    if (cachedManifestFolder !== undefined) {
      return cachedManifestFolder;
    }
    if (jobId === undefined) {
      return undefined;
    }
    try {
      const notebookPath = jobNotebookPaths(await readJob()).find((path) => path !== undefined);
      if (notebookPath === undefined) {
        report('Could not find the runner notebook path on job', jobId, 'to locate the app manifest');
        return undefined;
      }
      cachedManifestFolder = manifestFolderFromNotebookPath(notebookPath);
      return cachedManifestFolder;
    } catch (err) {
      report('Could not read the runner job to locate the app manifest', err);
      return undefined;
    }
  }

  async function readManifest() {
    const folder = await resolveManifestFolder();
    if (folder === undefined) {
      return undefined;
    }
    const manifestPath = `${folder}/${MANIFEST_FILENAME}`;
    try {
      const exported = await readWorkspaceJson('/api/2.0/workspace/export', {
        path: manifestPath,
        format: 'SOURCE',
      });
      if (!isRecord(exported) || typeof exported.content !== 'string') {
        return undefined;
      }
      return parseManifest(Buffer.from(exported.content, 'base64').toString('utf8'));
    } catch (err) {
      report('Could not read the app manifest from', manifestPath, err);
      return undefined;
    }
  }

  function parseManifest(raw: string): AppManifest | undefined {
    try {
      return appManifestSchema.safeParse(JSON.parse(raw)).data;
    } catch {
      return undefined;
    }
  }

  return {
    load: loadManifest,
    current: () => cachedManifest,
    clear() {
      cachedManifest = undefined;
      cachedManifestFolder = undefined;
    },
  };
}
