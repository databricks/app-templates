import { config } from 'dotenv';
import postgres from 'postgres';
import { getDatabricksToken } from '../databricks/auth/databricks-auth-node';
import {
  getPostgresUrlFromEnv,
  getDatabaseConfigFromEnv,
  buildConnectionUrl,
} from '../databricks/db/connection-core';

config({ path: '.env.local' });

async function getConnectionUrl() {
  // Use POSTGRES_URL if available
  const postgresUrl = getPostgresUrlFromEnv();
  if (postgresUrl) {
    return postgresUrl;
  }

  // Build from components using shared utilities
  const config = getDatabaseConfigFromEnv();
  if (!config) {
    throw new Error('Either POSTGRES_URL or PGHOST and PGDATABASE must be set');
  }

  const pgUser = process.env.PGUSER;
  if (!pgUser) {
    throw new Error('PGUSER must be set for OAuth authentication');
  }

  const token = await getDatabricksToken();
  return buildConnectionUrl(config, { username: pgUser, password: token });
}

async function resetDatabase() {
  console.log('🗑️  Resetting database schema...');

  try {
    const connectionUrl = await getConnectionUrl();
    const sql = postgres(connectionUrl);

    // Drop the ai_chatbot schema cascade
    console.log('Dropping ai_chatbot schema if it exists...');
    await sql`DROP SCHEMA IF EXISTS ai_chatbot CASCADE`;

    console.log('✅ Database reset complete!');
    await sql.end();
  } catch (error) {
    console.error('❌ Failed to reset database:', error);
    process.exit(1);
  }
}

resetDatabase();
