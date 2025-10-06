import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({
  path: '.env.local',
});

// Use fixed schema name for out-of-the-box functionality
function getSchemaName(): string {
  return 'ai_chatbot';
}

const schemaName = getSchemaName();
// For compatibility with drizzle-kit CLI, use PG* environment variables
// The password will be provided via PGPASSWORD environment variable from migrate.ts
export default defineConfig({
  schema: './databricks/db/schema.ts',
  out: './databricks/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.PGHOST || 'placeholder',
    port: Number.parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD, // Will be set by migrate.ts script
    database: process.env.PGDATABASE || 'placeholder',
    ssl: process.env.PGSSLMODE !== 'disable',
  },
  schemaFilter: [schemaName],
  verbose: true,
});
