// IMPORTANT: Load environment variables FIRST, before any other imports
// This ensures env vars are available when other modules are initialized
import { config } from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from project root
// When running with tsx, __dirname is packages/db/src
// When running compiled, __dirname is packages/db/dist
const projectRoot = join(__dirname, '..', '..', '..', '..');
const envPath = join(projectRoot, '.env.local');
console.log('Loading .env from:', envPath);
config({
  path: envPath,
});

// Now import other modules that depend on environment variables
import {
  isDatabaseAvailable,
  getSchemaName,
  getConnectionUrl,
} from './connection';
import { getDatabricksToken, getDatabaseUsername } from '@chat-template/auth';
import { spawnWithInherit } from '@chat-template/utils';

async function main() {
  const { default: postgres } = await import('postgres');
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
    // Start with current process.env which includes vars from tsx --env-file
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

    // Find drizzle-kit entry point
    const dbPackageDir = join(__dirname, '..');
    const projectRoot = join(__dirname, '..', '..', '..');

    // Use the actual drizzle-kit bin.cjs file (not the shell wrapper)
    const drizzleKitBin = join(
      projectRoot,
      'node_modules',
      'drizzle-kit',
      'bin.cjs',
    );

    console.log('projectRoot', projectRoot);
    console.log('dbPackageDir', dbPackageDir);
    console.log('drizzleKitBin', drizzleKitBin);

    // Run drizzle-kit from the db package directory so it finds drizzle.config.cjs
    const configPath = join(dbPackageDir, 'drizzle.config.ts');
    console.log(
      '🚀 Running: node',
      [drizzleKitBin, 'push', '--config', configPath, '--force'].join(' '),
    );
    console.log('📋 Environment check:');
    console.log('  - POSTGRES_URL:', env.POSTGRES_URL ? 'SET' : 'NOT SET');
    console.log('  - PGHOST:', env.PGHOST || 'NOT SET');
    console.log('  - PGDATABASE:', env.PGDATABASE || 'NOT SET');
    await spawnWithInherit(
      'node',
      [drizzleKitBin, 'push', '--config', configPath, '--force'],
      {
        env: env,
        cwd: dbPackageDir,
        errorMessagePrefix: 'drizzle-kit push failed',
      },
    );
    console.log('✅ drizzle-kit push completed successfully');
    console.log('✅ Database migration completed successfully');
  } catch (error) {
    console.log('error', error);
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
