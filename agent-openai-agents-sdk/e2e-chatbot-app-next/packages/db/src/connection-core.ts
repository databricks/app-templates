/**
 * Environment-agnostic database connection utilities
 * Can be used in both Next.js server components and Node.js contexts
 */

export interface DatabaseConfig {
  host: string;
  port: string;
  database: string;
  sslMode: string;
}

export interface DatabaseCredentials {
  username: string;
  password: string;
}

/**
 * Get the database schema name to use
 * Hardcoded to ai_chatbot for consistency with drizzle-kit generate
 */
export function getSchemaName(): string {
  const schemaName = 'ai_chatbot';
  console.log(`[getSchemaName] Using hardcoded schema: ${schemaName}`);
  return schemaName;
}

/**
 * Get database configuration from environment variables
 */
export function getDatabaseConfigFromEnv(): DatabaseConfig | null {
  const pgHost = process.env.PGHOST;
  const pgPort = process.env.PGPORT || '5432';
  const pgDatabase = process.env.PGDATABASE;
  const pgSSLMode = process.env.PGSSLMODE || 'require';

  if (!pgHost || !pgDatabase) {
    return null;
  }

  return {
    host: pgHost,
    port: pgPort,
    database: pgDatabase,
    sslMode: pgSSLMode,
  };
}

/**
 * Check if database storage is available
 */
export function isDatabaseAvailable(): boolean {
  const isAvailable = !!(process.env.PGDATABASE || process.env.POSTGRES_URL);
  console.log(`[isDatabaseAvailable] Database available: ${isAvailable}`);
  return isAvailable;
}

/**
 * Build PostgreSQL connection URL from config and credentials
 */
export function buildConnectionUrl(config: DatabaseConfig, credentials: DatabaseCredentials): string {
  const encodedUser = encodeURIComponent(credentials.username);
  const encodedPassword = encodeURIComponent(credentials.password);

  return `postgresql://${encodedUser}:${encodedPassword}@${config.host}:${config.port}/${config.database}?sslmode=${config.sslMode}`;
}

/**
 * Get connection URL using POSTGRES_URL if available
 */
export function getPostgresUrlFromEnv(): string | null {
  return process.env.POSTGRES_URL || null;
}

/**
 * Validate that required database environment variables are set
 */
export function validateDatabaseConfig(): void {
  if (!isDatabaseAvailable()) {
    throw new Error('Either POSTGRES_URL or PGHOST and PGDATABASE must be set');
  }
}