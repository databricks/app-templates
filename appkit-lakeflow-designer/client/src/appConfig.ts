import {
  appManifestSchema,
  type AppManifest,
  isValidMultiselectValue,
  errorMessage,
  isRecord,
  CONFIG_ROUTE,
} from '../../server/plugins/designer/client';

export type NotRunnableReason = 'noManifest' | 'noJob' | 'updating';

export type AppConfigState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: AppManifest; runnable: boolean; notRunnableReason?: NotRunnableReason }
  | { status: 'unavailable'; detail: string };

const STARTUP_RELOAD_KEY = 'designer-app:startup-reload';
let startupReloadRequested = false;

function reloadForStartup(): boolean {
  if (startupReloadRequested) return true;
  try {
    // The guard must survive navigation, so skip automatic recovery if storage is unavailable.
    if (window.sessionStorage.getItem(STARTUP_RELOAD_KEY) !== null) return false;
    window.sessionStorage.setItem(STARTUP_RELOAD_KEY, 'pending');
    window.location.reload();
    startupReloadRequested = true;
    return true;
  } catch {
    return false;
  }
}

export function parseAppManifest(raw: unknown): AppManifest | undefined {
  return appManifestSchema.safeParse(raw).data;
}

export function initialValuesFor(
  manifest: AppManifest,
  lastRunParameters?: Record<string, string>
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const parameter of manifest.parameters) {
    const recorded = lastRunParameters?.[parameter.name];
    if (parameter.type === 'file') {
      values[parameter.name] = '';
      continue;
    }
    if (parameter.type === 'multiselect') {
      values[parameter.name] = isValidMultiselectValue(recorded, parameter.choices ?? [])
        ? recorded
        : parameter.defaultValue;
      continue;
    }
    values[parameter.name] = recorded === undefined || recorded === '' ? parameter.defaultValue : recorded;
  }
  return values;
}

export function uploadConfigurationKey(manifest: AppManifest): string {
  return JSON.stringify([
    manifest.storage?.volume,
    manifest.storage?.path,
    manifest.parameters.filter(({ type }) => type === 'file').map(({ name, fileFormats }) => [name, fileFormats]),
  ]);
}

export function refreshedValuesFor(
  previous: AppManifest,
  next: AppManifest,
  values: Record<string, string>
): Record<string, string> {
  const sameUploads = uploadConfigurationKey(previous) === uploadConfigurationKey(next);
  return Object.fromEntries(
    next.parameters.map((parameter) => {
      const value = values[parameter.name];
      const sameType = previous.parameters.some(({ name, type }) => name === parameter.name && type === parameter.type);
      const valid =
        value !== undefined &&
        sameType &&
        (parameter.type !== 'file' || sameUploads) &&
        (parameter.type !== 'dropdown' || (parameter.choices ?? []).includes(value)) &&
        (parameter.type !== 'multiselect' || isValidMultiselectValue(value, parameter.choices ?? []));
      return [parameter.name, valid ? value : parameter.type === 'file' ? '' : parameter.defaultValue];
    })
  );
}

export async function fetchAppConfig(): Promise<AppConfigState> {
  try {
    const response = await fetch(CONFIG_ROUTE);
    if (
      response.status === 202 &&
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/html'
    ) {
      return reloadForStartup()
        ? { status: 'loading' }
        : { status: 'unavailable', detail: 'The App is starting. Reload the page to reconnect.' };
    }
    if (!response.ok) {
      return { status: 'unavailable', detail: `the server returned ${response.status}` };
    }
    const body: unknown = await response.json();
    if (!isRecord(body)) {
      return { status: 'unavailable', detail: 'the server returned an unreadable response' };
    }
    const manifest = parseAppManifest(body.manifest);
    if (manifest === undefined) {
      return { status: 'unavailable', detail: 'this app has no readable configuration' };
    }
    // Only a healthy response in the next document can reset automatic recovery.
    if (!startupReloadRequested) {
      try {
        window.sessionStorage.removeItem(STARTUP_RELOAD_KEY);
      } catch {
        // Configuration remains usable when the browser denies storage access.
      }
    }
    const reason = body.notRunnableReason;
    return {
      status: 'ready',
      manifest,
      runnable: body.runnable === true,
      ...(reason === 'noManifest' || reason === 'noJob' || reason === 'updating' ? { notRunnableReason: reason } : {}),
    };
  } catch (error) {
    return { status: 'unavailable', detail: errorMessage(error) };
  }
}
