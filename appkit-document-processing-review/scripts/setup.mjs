/**
 * Creates the two output objects for whatever INPUT_TABLE points at, by running
 * setup/setup.sql with the names substituted.
 *
 * Runs as *you*, not as the app's service principal, so the app never needs
 * CREATE on your schema: it only ever reads the input and appends to the log.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const input = process.env.INPUT_TABLE;
const warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
const profile = process.env.DATABRICKS_CONFIG_PROFILE;

if (!input || !/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(input)) {
  console.error('INPUT_TABLE must be set to a catalog.schema.table name');
  process.exit(1);
}
if (!warehouse) {
  console.error('DATABRICKS_WAREHOUSE_ID must be set');
  process.exit(1);
}

const leaf = input.split('.').pop();
const sql = readFileSync(new URL('../setup/setup.sql', import.meta.url), 'utf8')
  .replaceAll('<INPUT_TABLE>', input)
  .replaceAll('<INPUT_LEAF>', leaf);

// Statements are separated by ";\n" at the start of a line, so a semicolon
// inside a COMMENT string cannot split one in half.
const statements = sql
  .split(/;\s*\n(?=(?:--|CREATE))/)
  .map((s) => s.replace(/;\s*$/, '').trim())
  .filter((s) => s && !/^(--[^\n]*\n?)*$/.test(s));

for (const statement of statements) {
  const args = ['api', 'post', '/api/2.0/sql/statements'];
  if (profile) args.push('-p', profile);
  args.push('--json', JSON.stringify({ warehouse_id: warehouse, statement, wait_timeout: '50s' }));
  const out = execFileSync('databricks', args, { encoding: 'utf8' });
  const { status } = JSON.parse(out);
  const name = statement.match(/CREATE (?:OR REPLACE )?(TABLE|VIEW)[^(]*?([\w.]+)[\s(]/i);
  console.log(`${status.state}  ${name ? name[1] + ' ' + name[2] : 'statement'}`);
  if (status.state !== 'SUCCEEDED') {
    console.error(JSON.stringify(status.error ?? status, null, 2));
    process.exit(1);
  }
}
