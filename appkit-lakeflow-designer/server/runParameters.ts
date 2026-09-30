import { randomUUID } from 'node:crypto';
import type { AppStorage } from '../shared/storageConfig';
import { APP_VIEWER_PARAM, UploadError, resolveUpload, type UploadStore } from './fileUploads';
import { validateFileFormat } from '../shared/fileFormats';
import { FILE_OUTPUTS_PARAM, OUTPUT_NAMESPACE_PARAM, type FileOutputConfig } from '../shared/fileOutputs';
import { isValidMultiselectConfig, isValidMultiselectValue } from '../shared/multiselect';

export function isReservedParameter(name: string): boolean {
  return name === 'target_node' || name === 'ld_display_outputs' || name === 'ld_display_outputs_for' || name.startsWith('_lb_');
}

interface ParameterManifest {
  storage?: AppStorage;
  blocks?: { type: string; nodeId?: string; fileOutput?: FileOutputConfig }[];
  parameters: {
    name: string;
    label: string;
    type: string;
    defaultValue: string;
    choices?: string[];
    fileFormats?: string[];
  }[];
}

const DISPLAY_OUTPUTS_FOR_PARAM = 'ld_display_outputs_for';
const COLLECT_ROW_COUNTS_PARAM = '_lb_collect_row_counts';

function displayOutputsFor(manifest: ParameterManifest): string {
  return Array.from(
    new Set(
      (manifest.blocks ?? []).flatMap((block) =>
        block.type === 'output' && typeof block.nodeId === 'string' && block.nodeId !== '' ? [block.nodeId] : [],
      ),
    ),
  ).join(',');
}

export async function resolveRunParameters(
  manifest: ParameterManifest,
  submitted: Record<string, unknown>,
  viewer: string | undefined,
  store: UploadStore,
): Promise<{ ok: true; params: Record<string, string> } | { ok: false; error: string }> {
  const params: Record<string, string> = {};
  const fileOutputs = Object.fromEntries(
    (manifest.blocks ?? []).flatMap((block) =>
      block.type === 'output' && block.nodeId && block.fileOutput ? [[block.nodeId, block.fileOutput]] : [],
    ),
  );
  const privateApp = manifest.storage !== undefined || Object.keys(fileOutputs).length > 0;
  if (privateApp && !viewer)
    return { ok: false, error: 'Sign in through Databricks Apps to run an app with uploads or file outputs.' };
  for (const parameter of manifest.parameters) {
    if (isReservedParameter(parameter.name)) continue;
    const raw = submitted[parameter.name];
    if (parameter.type === 'multiselect') {
      const resolved = raw === undefined ? parameter.defaultValue : raw;
      if (
        !isValidMultiselectConfig(parameter.choices, parameter.defaultValue) ||
        !isValidMultiselectValue(resolved, parameter.choices ?? [])
      ) {
        return { ok: false, error: `"${parameter.label}" must contain only the offered choices.` };
      }
      params[parameter.name] = resolved;
      continue;
    }
    const value = raw === undefined || raw === null ? '' : String(raw);
    const resolved = value.trim() === '' ? parameter.defaultValue : value;
    if (parameter.type === 'file') {
      if (!manifest.storage || !viewer) return { ok: false, error: 'File uploads are not configured.' };
      try {
        const { path, upload } = await resolveUpload(store, manifest.storage, viewer, parameter.name, resolved);
        const formatError = validateFileFormat(upload.filename, parameter.fileFormats);
        if (formatError) return { ok: false, error: formatError };
        params[parameter.name] = path;
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof UploadError
              ? error.message
              : 'Could not verify the uploaded file. Try uploading it again.',
        };
      }
      continue;
    }
    if (parameter.type === 'dropdown' && Array.isArray(parameter.choices) && !parameter.choices.includes(resolved)) {
      return { ok: false, error: `"${parameter.label}" must be one of the offered choices.` };
    }
    params[parameter.name] = resolved;
  }
  // Supplying notebook_params on run-now can replace the runner job's base parameters. Always
  // carry the server-owned display controls with the viewer's values so selected source operators
  // (and every other published output) render for parameterized runs as well.
  const displayedNodes = displayOutputsFor(manifest);
  if (displayedNodes !== '') {
    params[DISPLAY_OUTPUTS_FOR_PARAM] = displayedNodes;
    params[COLLECT_ROW_COUNTS_PARAM] = 'true';
  }
  // An empty override is intentional: a partially completed republish may leave newer
  // file-writing Job defaults behind the current manifest. Never inherit that policy.
  params[FILE_OUTPUTS_PARAM] = JSON.stringify(fileOutputs);
  // The runtime adds an attempt ID and node ID beneath this server-owned submission namespace.
  // Consumer parameters must not choose/reuse a previous run's artifact directory.
  if (Object.keys(fileOutputs).length > 0) params[OUTPUT_NAMESPACE_PARAM] = randomUUID();
  if (privateApp && viewer) params[APP_VIEWER_PARAM] = viewer;
  return { ok: true, params };
}
