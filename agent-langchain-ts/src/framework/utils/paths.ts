/**
 * Path utilities for the unified server
 * Isolated to allow mocking in test environments
 */

import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Get the root directory of the project
 * In production: /app/python/source_code
 * In development: /Users/sid/app-templates/agent-langchain-ts
 */
export function getProjectRoot(): string {
  const filename = fileURLToPath(import.meta.url);
  // From dist/src/framework/utils/paths.js -> up 4 levels to root
  let dir = path.dirname(filename); // utils/
  dir = path.dirname(dir);          // framework/
  dir = path.dirname(dir);          // src/ (dev) or dist/src/ (prod, going through dist)
  dir = path.dirname(dir);          // root (dev) or dist/ (prod)

  // If we're in dist/, go up one more level to get to project root
  if (path.basename(dir) === 'dist') {
    return path.dirname(dir);
  }

  return dir;
}

/**
 * Get the default path for UI static files
 */
export function getDefaultUIStaticPath(): string {
  return path.join(getProjectRoot(), 'ui', 'client', 'dist');
}

/**
 * Get the path for UI server app module
 * Returns path to the bundled Express app (default export)
 */
export function getDefaultUIRoutesPath(): string {
  return path.join(getProjectRoot(), 'ui', 'server', 'dist', 'index.mjs');
}

/**
 * Check if the current module is being run directly
 * Works in both dev (tsx) and production (node dist/src/main.js)
 */
export function isMainModule(): boolean {
  // In production, process.argv[1] might be the compiled .js file
  // In dev, it might be the .ts file
  const scriptPath = process.argv[1];
  const currentModuleUrl = import.meta.url;

  // Check exact match first
  if (currentModuleUrl === `file://${scriptPath}`) {
    return true;
  }

  // Also check if script path ends with the full module path suffix (handles compiled JS)
  // e.g., dist/src/main.js should match when running "node dist/src/main.js"
  // Be specific to avoid matching any random main.js in node_modules
  const modulePath = fileURLToPath(currentModuleUrl);
  return modulePath === scriptPath || scriptPath.endsWith('dist/src/main.js');
}
