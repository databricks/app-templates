import { randomUUID } from 'node:crypto';

import { isReservedParameter } from '../shared/appManifest';
import { validateFileFormat } from '../shared/fileFormats';
import { FILE_OUTPUTS_PARAM, OUTPUT_NAMESPACE_PARAM, type FileOutputConfig } from '../shared/fileOutputs';
import { isValidMultiselectConfig, isValidMultiselectValue } from '../shared/multiselect';
import { RUNNER_REVISION_PARAM, type PublishedRunner } from '../shared/publishedRunner';
import type { AppStorage } from '../shared/storageConfig';
import { UPLOAD_UNAVAILABLE, UPLOAD_UNAVAILABLE_MESSAGE } from '../shared/storageConfig';
import { APP_VIEWER_PARAM, UploadError, resolveUpload, type UploadStore } from './fileUploads';
import { APP_PARAMETERS_PARAM } from './runAttribution';

export { isReservedParameter };

interface ParameterManifest {
  runner?: PublishedRunner;
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
        block.type === 'output' && typeof block.nodeId === 'string' && block.nodeId !== '' ? [block.nodeId] : []
      )
    )
  ).join(',');
}

export async function resolveRunParameters(
  manifest: ParameterManifest,
  submitted: Record<string, unknown>,
  viewer: string | undefined,
  store: UploadStore
): Promise<
  { ok: true; params: Record<string, string> } | { ok: false; error: string; code?: typeof UPLOAD_UNAVAILABLE }
> {
  // Pin hidden defaults as well as exposed inputs to the selected publication. A Job reset can
  // race submission, so inheriting the Job's newer defaults would mix publication versions.
  const params: Record<string, string> = { ...manifest.runner?.parameters };
  const filenames = new Map<string, string>();
  const fileOutputs = Object.fromEntries(
    (manifest.blocks ?? []).flatMap((block) =>
      block.type === 'output' && block.nodeId && block.fileOutput ? [[block.nodeId, block.fileOutput]] : []
    )
  );
  if (!viewer)
    return {
      ok: false,
      error: 'Sign in through Databricks Apps to run this app.',
    };
  for (const parameter of manifest.parameters) {
    if (isReservedParameter(parameter.name)) continue;
    const raw = submitted[parameter.name];
    if (parameter.type === 'multiselect') {
      const resolved = raw === undefined ? parameter.defaultValue : raw;
      if (
        !isValidMultiselectConfig(parameter.choices, parameter.defaultValue) ||
        !isValidMultiselectValue(resolved, parameter.choices ?? [])
      ) {
        return {
          ok: false,
          error: `"${parameter.label}" must contain only the offered choices.`,
        };
      }
      params[parameter.name] = resolved;
      continue;
    }
    if (
      raw !== undefined &&
      raw !== null &&
      typeof raw !== 'string' &&
      typeof raw !== 'number' &&
      typeof raw !== 'boolean'
    ) {
      return {
        ok: false,
        error: `"${parameter.label}" must be a string, number or boolean.`,
      };
    }
    const value = raw === undefined || raw === null ? '' : String(raw);
    const resolved = value.trim() === '' ? parameter.defaultValue : value;
    if (parameter.type === 'file') {
      if (!manifest.storage || !viewer)
        return {
          ok: false,
          error: UPLOAD_UNAVAILABLE_MESSAGE,
          code: UPLOAD_UNAVAILABLE,
        };
      try {
        const { path, upload } = await resolveUpload(store, manifest.storage, viewer, parameter.name, resolved);
        const formatError = validateFileFormat(upload.filename, parameter.fileFormats);
        if (formatError) return { ok: false, error: formatError };
        params[parameter.name] = path;
        filenames.set(parameter.name, upload.filename);
      } catch (error) {
        if (!(error instanceof UploadError)) {
          return {
            ok: false,
            error: 'Could not verify the uploaded file. Try Run again after storage is available.',
          };
        }
        if (error.code === UPLOAD_UNAVAILABLE) return { ok: false, error: error.message, code: UPLOAD_UNAVAILABLE };
        if ([400, 404, 409].includes(error.status)) {
          return {
            ok: false,
            error: `${error.message} Upload the file again.`,
            code: UPLOAD_UNAVAILABLE,
          };
        }
        return { ok: false, error: error.message };
      }
      continue;
    }
    if (parameter.type === 'dropdown' && Array.isArray(parameter.choices) && !parameter.choices.includes(resolved)) {
      return {
        ok: false,
        error: `"${parameter.label}" must be one of the offered choices.`,
      };
    }
    params[parameter.name] = resolved;
  }
  // Override all server-owned controls so a partially completed republish cannot change this
  // manifest's output policy through newer Job defaults.
  const displayedNodes = displayOutputsFor(manifest);
  if (displayedNodes !== '') {
    params[DISPLAY_OUTPUTS_FOR_PARAM] = displayedNodes;
    params[COLLECT_ROW_COUNTS_PARAM] = 'true';
  }
  // An empty override is intentional: a partially completed republish may leave newer
  // file-writing Job defaults behind the current manifest. Never inherit that policy.
  params[FILE_OUTPUTS_PARAM] = JSON.stringify(fileOutputs);
  params._lb_file_output_volume = manifest.runner?.parameters._lb_file_output_volume ?? '';
  if (manifest.runner) params[RUNNER_REVISION_PARAM] = manifest.runner.revision;
  // The runtime adds an attempt ID and node ID beneath this server-owned submission namespace.
  // Consumer parameters must not choose/reuse a previous run's artifact directory.
  if (Object.keys(fileOutputs).length > 0) params[OUTPUT_NAMESPACE_PARAM] = randomUUID();
  params[APP_VIEWER_PARAM] = viewer;
  // Preserve labels and resolved values at submission time, including inputs later removed or
  // renamed on republish. File reporting exposes the filename rather than its private storage path.
  params[APP_PARAMETERS_PARAM] = JSON.stringify(
    Object.fromEntries(
      manifest.parameters
        .filter(({ name }) => !isReservedParameter(name))
        .map((parameter) => [
          parameter.name,
          {
            label: parameter.label,
            type: parameter.type,
            value: filenames.get(parameter.name) ?? params[parameter.name],
          },
        ])
    )
  );
  return { ok: true, params };
}
