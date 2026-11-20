import type { WorkspaceClient } from './workspaceClient';
import { fileSize, isMissingFile } from './workspaceFiles';
import { isOutputFilePath } from '../shared/fileOutputs';

export interface OutputFileStore {
  size(path: string): Promise<number | undefined>;
  download(path: string): Promise<ReadableStream<Uint8Array>>;
}

export function createOutputFileStore(client: WorkspaceClient, volume: string): OutputFileStore {
  return {
    async size(path) {
      if (!isOutputFilePath(path, { volumes: [volume] })) throw new Error('Invalid output file destination.');
      try {
        return await fileSize(client, path);
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
    },
    async download(path) {
      if (!isOutputFilePath(path, { volumes: [volume] })) throw new Error('Invalid output file destination.');
      const result = await client.files.downloadFile({ filePath: path });
      if (!result.contents) throw new Error('The output file has no readable contents.');
      return result.contents;
    },
  };
}
