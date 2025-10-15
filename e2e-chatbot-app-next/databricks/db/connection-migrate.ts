/**
 * Database connection utilities for migration scripts (Node.js compatible)
 */
import {
  getDatabricksToken,
  getAuthMethodDescription,
  getDatabaseUsername,
} from '@/databricks/auth/databricks-auth-node';
import {
  getSchemaName,
  getDatabaseConfigFromEnv,
  buildConnectionUrl,
  getPostgresUrlFromEnv,
  validateDatabaseConfig,
  isDatabaseAvailable,
} from './connection-core';

// Re-export core functions
export { getSchemaName, isDatabaseAvailable };

/**
 * Build PostgreSQL connection URL, supporting both POSTGRES_URL and PG* variables
 * with either OAuth (service principal) or PAT-based database credentials
 */
export async function getConnectionUrl(): Promise<string> {
  // Option 1: Use POSTGRES_URL if provided
  const postgresUrl = getPostgresUrlFromEnv();
  if (postgresUrl) {
    return postgresUrl;
  }

  // Option 2: Build URL from individual PG* variables with Databricks authentication
  validateDatabaseConfig();

  const config = getDatabaseConfigFromEnv();
  if (!config) {
    throw new Error('Either POSTGRES_URL or PGHOST and PGDATABASE must be set');
  }

  // Get authentication token and username using centralized auth module
  const token = await getDatabricksToken();
  const username = await getDatabaseUsername();
  console.log(
    `[Connection] Using ${getAuthMethodDescription()} authentication with user: ${username}`,
  );

  return buildConnectionUrl(config, { username, password: token });
}
