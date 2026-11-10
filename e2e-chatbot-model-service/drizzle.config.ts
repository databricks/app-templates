import { defineConfig } from 'drizzle-kit';

// Use fixed schema name for out-of-the-box functionality
function getSchemaName() {
  return 'ai_chatbot';
}

// Environment variables are already loaded by tsx --env-file in migrate.ts
// and passed to this process via the env parameter

const schemaName = getSchemaName();
// For compatibility with drizzle-kit CLI, use PG* environment variables
// The password will be provided via PGPASSWORD environment variable from migrate.ts
module.exports = defineConfig({
  schema: './packages/db/src/schema.ts',
  out: './packages/db/migrations',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    host: process.env.PGHOST || '',
    port: Number.parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD, // Will be set by migrate.ts script
    database: process.env.PGDATABASE || '',
    url: process.env.POSTGRES_URL,
    ssl: process.env.PGSSLMODE !== 'disable',
  },
  schemaFilter: [schemaName],
  verbose: true,
});
