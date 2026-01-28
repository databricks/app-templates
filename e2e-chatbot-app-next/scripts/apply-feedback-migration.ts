import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { getConnectionUrl, isDatabaseAvailable } from '@chat-template/db';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
config({ path: join(projectRoot, '.env.local') });

async function main() {
  if (!isDatabaseAvailable()) {
    console.error('Database not available');
    process.exit(1);
  }

  const connectionUrl = await getConnectionUrl();
  const sql = postgres(connectionUrl, { max: 1 });

  try {
    console.log('Applying feedback table migration...');
    
    const migrationSql = readFileSync(
      join(projectRoot, 'packages/db/migrations/0001_add_feedback_table.sql'),
      'utf-8'
    );
    
    // Execute the migration
    await sql.unsafe(migrationSql);
    
    console.log('✅ Feedback table migration applied successfully!');
    
    // Verify the table was created
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'ai_chatbot' AND table_name = 'Feedback'
    `;
    
    if (tables.length > 0) {
      console.log('✅ Feedback table verified in database');
    } else {
      console.log('⚠️ Feedback table not found after migration');
    }
    
    await sql.end();
  } catch (error: any) {
    console.error('❌ Error applying migration:', error.message);
    await sql.end();
    process.exit(1);
  }
}

main();
