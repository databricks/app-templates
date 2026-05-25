#!/usr/bin/env node
// Derives the Lakebase bundle variables (postgres_branch, postgres_database)
// from .env + the Lakebase Postgres API, and writes them to
// .databricks/bundle/default/variable-overrides.json so `databricks bundle
// deploy` can resolve the ${var.*} references in databricks.yml.
//
// Why this exists: `databricks apps init --set lakebase.postgres.{branch,database}=...`
// writes local env vars (LAKEBASE_ENDPOINT, PGDATABASE) but does NOT persist
// the fully-qualified resource names anywhere the bundle can read directly.
// This script reconstructs them and hydrates the bundle variable overrides.
//
// Safe to re-run; the output file is overwritten each time.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(projectRoot, '.env');
const overridesDir = resolve(projectRoot, '.databricks/bundle/default');
const overridesPath = resolve(overridesDir, 'variable-overrides.json');

if (!existsSync(envPath)) {
  console.error(`sync-bundle-vars: ${envPath} not found. Run \`databricks apps init\` first.`);
  process.exit(1);
}
const envText = readFileSync(envPath, 'utf8');
const readEnv = (name) => new RegExp(`^${name}=(.+)$`, 'm').exec(envText)?.[1]?.trim();

const profile = readEnv('DATABRICKS_CONFIG_PROFILE');
const endpoint = readEnv('LAKEBASE_ENDPOINT');
const pgDatabase = readEnv('PGDATABASE');

if (!endpoint) {
  console.error('sync-bundle-vars: LAKEBASE_ENDPOINT missing from .env.');
  process.exit(1);
}
if (!pgDatabase) {
  console.error('sync-bundle-vars: PGDATABASE missing from .env.');
  process.exit(1);
}

const branchMatch = /^(projects\/[^/]+\/branches\/[^/]+)\//.exec(endpoint);
if (!branchMatch) {
  console.error(`sync-bundle-vars: could not extract branch from LAKEBASE_ENDPOINT=${endpoint}`);
  process.exit(1);
}
const postgresBranch = branchMatch[1];

const args = ['api', 'get', `/api/2.0/postgres/${postgresBranch}/databases`];
if (profile) args.push('--profile', profile);

let raw;
try {
  raw = execFileSync('databricks', args, { encoding: 'utf8' });
} catch (err) {
  console.error(`sync-bundle-vars: \`databricks ${args.join(' ')}\` failed:\n${err.stderr || err.message}`);
  process.exit(1);
}

const databases = JSON.parse(raw).databases ?? [];
const match = databases.find((d) => d.status?.postgres_database === pgDatabase);
if (!match) {
  console.error(
    `sync-bundle-vars: no database on ${postgresBranch} has postgres_database="${pgDatabase}". ` +
      `Available: ${databases.map((d) => d.status?.postgres_database).join(', ') || '(none)'}`
  );
  process.exit(1);
}

mkdirSync(overridesDir, { recursive: true });
writeFileSync(
  overridesPath,
  JSON.stringify({ postgres_branch: postgresBranch, postgres_database: match.name }, null, 2) + '\n'
);

console.log(`sync-bundle-vars: wrote ${overridesPath}`);
console.log(`  postgres_branch   = ${postgresBranch}`);
console.log(`  postgres_database = ${match.name}`);
