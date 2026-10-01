import { createHash } from 'node:crypto';
import type { FileOutputConfig } from '../shared/fileOutputs';
import type { AppStorage } from '../shared/storageConfig';
import { runJobParameters } from './jobParameters';

export interface FileOutputManifest {
  storage?: AppStorage;
  blocks: { type: string; id?: string; nodeId?: string; port?: string; fileOutput?: FileOutputConfig }[];
  parameters: { name: string }[];
}

export function manifestRevision(manifest: FileOutputManifest): string {
  // Runner notebook identity is verified separately. Labels, ordering, defaults and publication
  // timestamps do not change a completed write's destination or ownership.
  const outputs = manifest.blocks
    .filter((block) => block.type === 'output')
    .map((block) => ({
      id: block.id ?? '',
      nodeId: block.nodeId,
      port: block.port,
      ...(block.fileOutput ? { fileOutput: { volumes: [...new Set(block.fileOutput.volumes)].sort() } } : {}),
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const revision = createHash('sha256')
    .update(JSON.stringify({
      storage: manifest.storage && { volume: manifest.storage.volume, path: manifest.storage.path },
      parameters: manifest.parameters.map((parameter) => parameter.name).sort(),
      outputs,
    }))
    .digest('hex');
  return `file-outputs-v1:${revision}`;
}

// Old converter runs can still be present in this Job's history after republishing.
export const isLegacyExportRun = (run: unknown) => typeof runJobParameters(run)._lb_export_request === 'string';
