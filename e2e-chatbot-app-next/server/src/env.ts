import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if running in test mode
const TEST_MODE = process.env.TEST_MODE;

if (TEST_MODE) {
  console.log(`[ENV] Running in TEST_MODE=${TEST_MODE}`);

  // Load .env.local first (base configuration)
  // Then load test-specific env file (overrides .env.local)
  const testEnvFile =
    TEST_MODE === 'ephemeral' ? '.env.test.ephemeral' : '.env.test.with-db';

  dotenv.config({
    path: [
      path.resolve(__dirname, '../..', '.env.local'),
      path.resolve(__dirname, '../..', testEnvFile),
    ],
    override: true,
  });

  console.log(`[ENV] Loaded .env.local + ${testEnvFile}`);
} else {
  // Production/development mode: load .env.local
  dotenv.config({
    path: path.resolve(__dirname, '../..', '.env.local'),
  });
}

// Debug logging for database configuration
console.log('[ENV] Database configuration:');
console.log(
  '  POSTGRES_URL:',
  process.env.POSTGRES_URL ? '✓ set' : '✗ not set',
);
console.log('  PGDATABASE:', process.env.PGDATABASE || '(not set)');
console.log('  PGHOST:', process.env.PGHOST || '(not set)');
