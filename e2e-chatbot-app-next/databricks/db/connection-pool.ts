/**
 * Database connection pooling using centralized Databricks authentication
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { getConnectionUrl, getSchemaName } from './connection';
import { getDatabricksToken } from '@/databricks/auth/databricks-auth';

// Connection pool management
let sqlConnection: postgres.Sql | null = null;
let currentToken: string | null = null;

async function getConnection(): Promise<postgres.Sql> {
  // Get the current token to check if it's changed
  const freshToken = await getDatabricksToken();

  // If we have a connection but the token has changed, we need to recreate the connection
  // This ensures we're always using a valid token
  if (sqlConnection && currentToken !== freshToken) {
    console.log('[DB Pool] Token changed, closing existing connection pool');
    await sqlConnection.end();
    sqlConnection = null;
    currentToken = null;
  }

  // Create a new connection if needed
  if (!sqlConnection) {
    const connectionUrl = await getConnectionUrl();
    sqlConnection = postgres(connectionUrl, {
      max: 10, // connection pool size
      idle_timeout: 20, // close idle connections after 20 seconds
      connect_timeout: 10,
      // Important: Set max_lifetime to ensure connections don't outlive the token
      // OAuth tokens typically expire in 1 hour, we'll refresh connections more frequently
      max_lifetime: 60 * 10, // 10 minutes max connection lifetime
    });

    currentToken = freshToken;
    console.log('[DB Pool] Created new connection pool with fresh OAuth token');
  }

  return sqlConnection;
}

// Export a function to get the Drizzle instance with fresh connection
export async function getDb() {
  const sql = await getConnection();

  // Set the search_path to include our custom schema
  const schemaName = getSchemaName();
  if (schemaName !== 'public') {
    try {
      await sql`SET search_path TO ${sql(schemaName)}, public`;
      console.log(
        `[DB Pool] Set search_path to include schema '${schemaName}'`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[DB Pool] Failed to set search_path for '${schemaName}':`,
        errorMessage,
      );
      // Don't throw - continue anyway
    }
  }

  return drizzle(sql, { schema });
}
