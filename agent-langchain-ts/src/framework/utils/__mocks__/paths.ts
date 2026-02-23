/**
 * Mock implementation of paths utility for testing
 * Avoids import.meta.url which doesn't work in Jest
 */

import path from 'path';

export function getMainModuleDir(): string {
  return process.cwd();
}

export function getDefaultUIStaticPath(): string {
  return path.join(process.cwd(), 'ui', 'client', 'dist');
}

export function getDefaultUIRoutesPath(): string {
  return path.join(process.cwd(), 'ui', 'server', 'dist', 'routes', 'index.js');
}

export function isMainModule(): boolean {
  // Never run main module logic in tests
  return false;
}
