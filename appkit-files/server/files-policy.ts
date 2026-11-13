import path from 'node:path';
import type { FileAction, FilePolicy } from '@databricks/appkit';

// The last path segment of these actions becomes a new file or folder name.
const CREATE_ACTIONS: ReadonlySet<FileAction> = new Set(['upload', 'mkdir']);

function hasControlCharacter(value: string) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Keeps every Files plugin operation inside its configured volume. A path must be
 * relative (as the UI sends it) or absolute under the volume's
 * DATABRICKS_VOLUME_<KEY> root, with no `..` segments, no control characters and
 * a non-empty final name. New file and folder names must not contain `\`.
 */
export const withinVolume: FilePolicy = (action, { path: filePath, volume }) => {
  // A list request without a path reaches the policy as '/', meaning the volume root.
  if (action === 'list' && filePath === '/') return true;
  if (!filePath || hasControlCharacter(filePath)) return false;

  const segments = filePath.split('/');
  const name = segments[segments.length - 1];
  if (segments.includes('..') || name === '' || name === '.') return false;
  if (CREATE_ACTIONS.has(action) && name.includes('\\')) return false;

  if (!path.posix.isAbsolute(filePath)) return true;
  const root = process.env[`DATABRICKS_VOLUME_${volume.toUpperCase()}`];
  if (!root) return false;
  const volumeRoot = path.posix.resolve(root);
  const resolved = path.posix.resolve(filePath);
  return resolved === volumeRoot || resolved.startsWith(`${volumeRoot}/`);
};
