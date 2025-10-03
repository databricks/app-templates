import { config } from 'dotenv';
import {
  isDatabaseAvailable,
  getSchemaName,
  getConnectionUrl,
} from './connection-migrate';
import {
  getDatabricksToken,
  getDatabaseUsername,
} from '@/databricks/auth/databricks-auth-node';
import { spawnWithInherit } from '@/databricks/utils/subprocess';
import postgres from 'postgres';
import { join } from 'node:path';

// Load environment variables
config({
  path: '.env.local',
});

async function main() {
  console.log('🔄 Running database migration...');

  // Require database configuration
  if (!isDatabaseAvailable()) {
    console.error('❌ Database configuration required!');
    console.error(
      '❌ Please set PGDATABASE/PGHOST/PGUSER or POSTGRES_URL environment variables.',
    );
    process.exit(1);
  }

  console.log('📊 Database configuration detected, running migrations...');

  const schemaName = getSchemaName();
  console.log(`🗃️ Using database schema: ${schemaName}`);

  // Create custom schema if needed
  const connectionUrl = await getConnectionUrl();
  try {
    const schemaConnection = postgres(connectionUrl, { max: 1 });

    console.log(`📁 Creating schema '${schemaName}' if it doesn't exist...`);
    await schemaConnection`CREATE SCHEMA IF NOT EXISTS ${schemaConnection(schemaName)}`;
    console.log(`✅ Schema '${schemaName}' ensured to exist`);

    await schemaConnection.end();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ Schema creation warning:`, errorMessage);
    // Continue with migration even if schema creation had issues
  }

  try {
    // Use drizzle-kit push to create tables
    console.log('🔄 Using drizzle-kit push to update schema...');

    // Get OAuth token and username for database authentication
    const env = { ...process.env };
    if (!process.env.POSTGRES_URL) {
      console.log(
        '🔐 Using OAuth token and username for database authentication',
      );
      try {
        const token = await getDatabricksToken();
        const username = await getDatabaseUsername();
        env.PGPASSWORD = token;
        env.PGUSER = username;
        console.log(`🔐 Setting PGUSER to: ${username}`);
      } catch (tokenError) {
        const errorMessage =
          tokenError instanceof Error ? tokenError.message : String(tokenError);
        throw new Error(`Failed to get OAuth credentials: ${errorMessage}`);
      }
    } else {
      console.log(
        '🔐 Using credentials from POSTGRES_URL for database authentication',
      );
    }

    // Find the drizzle-kit binary path
    const projectRoot = join(__dirname, '..', '..');
    const drizzleBin = join(projectRoot, 'node_modules', '.bin', 'drizzle-kit');

    await spawnWithInherit(drizzleBin, ['push', '--force'], {
      env: env,
      errorMessagePrefix: 'drizzle-kit push failed',
    });
    console.log('✅ drizzle-kit push completed successfully');
    console.log('✅ Database migration completed successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Database migration failed:', errorMessage);
    process.exit(1);
  }
}

main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('❌ Migration script failed:', errorMessage);
  process.exit(1);
});
