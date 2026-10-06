import { CONFIG_ROUTE } from './routes';
import { appManifestSchema, type AppManifest } from '../../shared/appManifest';
import { isValidMultiselectValue } from '../../shared/multiselect';

export type NotRunnableReason = 'noManifest' | 'noJob';

export type AppConfigState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: AppManifest; runnable: boolean; notRunnableReason?: NotRunnableReason }
  | { status: 'unavailable'; detail: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseAppManifest(raw: unknown): AppManifest | undefined {
  return appManifestSchema.safeParse(raw).data;
}

export function initialValuesFor(
  manifest: AppManifest,
  lastRunParameters?: Record<string, string>,
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
  values: Record<string, string>,
): Record<string, string> {
  const sameUploads = uploadConfigurationKey(previous) === uploadConfigurationKey(next);
  return Object.fromEntries(
    next.parameters.map((parameter) => {
      const value = values[parameter.name];
      const sameType = previous.parameters.some(({ name, type }) => name === parameter.name && type === parameter.type);
      const valid =
        value !== undefined && sameType &&
        (parameter.type !== 'file' || sameUploads) &&
        (parameter.type !== 'dropdown' || (parameter.choices ?? []).includes(value)) &&
        (parameter.type !== 'multiselect' || isValidMultiselectValue(value, parameter.choices ?? []));
      return [parameter.name, valid ? value : parameter.type === 'file' ? '' : parameter.defaultValue];
    }),
  );
}

export async function fetchAppConfig(): Promise<AppConfigState> {
  try {
    const response = await fetch(CONFIG_ROUTE);
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
    const reason = body.notRunnableReason;
    return {
      status: 'ready',
      manifest,
      runnable: body.runnable === true,
      ...(reason === 'noManifest' || reason === 'noJob' ? { notRunnableReason: reason } : {}),
    };
  } catch (error) {
    return { status: 'unavailable', detail: error instanceof Error ? error.message : String(error) };
  }
}
