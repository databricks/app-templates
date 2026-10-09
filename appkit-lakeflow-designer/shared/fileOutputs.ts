export const FILE_OUTPUTS_PARAM = '_lb_file_outputs';
export const OUTPUT_NAMESPACE_PARAM = '_lb_output_namespace';
export const APP_REVISION_PARAM = '_lb_app_revision';
export const FILE_OUTPUTS_MIME_TYPE = 'application/vnd.databricks.lakeflow-designer.files+json';
export const MAX_OUTPUT_FILES = 50;

export interface FileOutputConfig {
  volumes: string[];
}
export interface WrittenFile {
  path: string;
}
export type FileOutputBehavior = 'run_artifact' | 'shared_append' | 'shared_workbook_update';

export function parseFileOutputBehavior(value: unknown): FileOutputBehavior | undefined {
  return value === 'run_artifact' || value === 'shared_append' || value === 'shared_workbook_update'
    ? value
    : undefined;
}

export interface WrittenFiles {
  node: string;
  files: WrittenFile[];
  // Older receipts omit this; never infer run isolation from a path or the current manifest.
  behavior?: FileOutputBehavior;
}

export function parseFileOutput(value: unknown): FileOutputConfig | undefined {
  if (
    typeof value !== 'object' || value === null || !('volumes' in value) ||
    !Array.isArray(value.volumes) || value.volumes.length === 0 || value.volumes.length > 50
  ) {
    return undefined;
  }
  if (!value.volumes.every((volume): volume is string =>
    typeof volume === 'string' && volume.split('.').length === 3 &&
    volume.split('.').every((name) => /^[A-Za-z0-9_-]+$/.test(name)),
  )) {
    return undefined;
  }
  return { volumes: [...new Set(value.volumes)].sort() };
}

export function hasInvalidFileOutputDeclaration(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false;
  const records = blocks.filter((block): block is Record<string, unknown> =>
    typeof block === 'object' && block !== null && !Array.isArray(block),
  );
  const outputIds = records.filter((block) => block.type === 'output').map((block) => block.id);
  // Preview blocks may be omitted when malformed. File blocks must fail closed instead:
  // dropping one could remove the ownership/policy controls while the runner still writes it.
  return records.some((block) => block.fileOutput !== undefined && (
    block.type !== 'output' ||
    typeof block.id !== 'string' || block.id.trim() === '' ||
    typeof block.nodeId !== 'string' || block.nodeId.trim() === '' ||
    outputIds.filter((id) => id === block.id).length !== 1 ||
    parseFileOutput(block.fileOutput) === undefined
  ));
}

// Require literal, canonical paths. Never normalize an untrusted path into the approved scope.
export function isOutputFilePath(path: unknown, config: FileOutputConfig): path is string {
  if (typeof path !== 'string' || path.length > 4096 || /[\\\x00-\x1f\x7f]/.test(path)) return false;
  const root = config.volumes
    .map((volume) => `/Volumes/${volume.replaceAll('.', '/')}/`)
    .find((root) => path.startsWith(root));
  if (!root) return false;
  const segments = path.slice(root.length).split('/');
  return (
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    /\.(csv|json|xlsx)$/i.test(segments.at(-1) ?? '')
  );
}

export const fileDownloadRoute = (runId: string, outputId: string, index: number) =>
  `/api/designer/run/${encodeURIComponent(runId)}/files/${encodeURIComponent(outputId)}/${index}/download`;
