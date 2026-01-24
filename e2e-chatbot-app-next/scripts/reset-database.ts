import { config } from 'dotenv';
import postgres from 'postgres';
import * as readline from 'node:readline';
import { getDatabricksToken } from '@chat-template/auth';
import {
  getPostgresUrlFromEnv,
  getDatabaseConfigFromEnv,
  buildConnectionUrl,
} from '@chat-template/db';

config({ path: '.env' });

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

function promptConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function resetDatabase() {
  console.log('\n⚠️  WARNING: DATABASE RESET ⚠️\n');
  console.log('This operation will permanently delete:');
  console.log('  • All chat conversations');
  console.log('  • All user data');
  console.log('  • All messages');
  console.log('  • Drizzle migration history');
  console.log('  • The entire ai_chatbot schema\n');
  console.log('This action CANNOT be undone!\n');

  const confirmed = await promptConfirmation(
    'Are you sure you want to continue? Type "yes" or "y" to confirm: ',
  );

  if (!confirmed) {
    console.log('\n❌ Database reset cancelled.');
    process.exit(0);
  }

  console.log('\n🗑️  Resetting database schema and migrations...');

  try {
    const connectionUrl = await getConnectionUrl();
    const sql = postgres(connectionUrl);

    // Drop the ai_chatbot schema cascade (includes all tables)
    console.log('Dropping ai_chatbot schema if it exists...');
    await sql`DROP SCHEMA IF EXISTS ai_chatbot CASCADE`;
    console.log('✅ Schema dropped');

    // Drop drizzle migrations table from drizzle schema if it exists
    await sql`DROP TABLE IF EXISTS drizzle.__drizzle_migrations CASCADE`;
    console.log('✅ Drizzle schema migrations table dropped if existed');

    console.log('\n✅ Database reset complete! All data and migrations removed.');
    console.log('💡 Run "npm run db:migrate" to recreate the schema and apply migrations.\n');
    await sql.end();
  } catch (error) {
    console.error('❌ Failed to reset database:', error);
    process.exit(1);
  }
}

resetDatabase();
