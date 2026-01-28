import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    // Check Message table columns
    const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'ai_chatbot' 
      AND table_name = 'Message'
      ORDER BY ordinal_position
    `;
    
    console.log('\n=== Message table columns ===');
    columns.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}`);
    });
    
    // Check applied migrations
    const migrations = await sql`
      SELECT * FROM drizzle.__drizzle_migrations
      ORDER BY created_at
    `;
    
    console.log('\n=== Applied migrations ===');
    migrations.forEach(m => {
      console.log(`  ${m.hash} - ${m.created_at}`);
    });
    
    await sql.end();
  } catch (error: any) {
    console.error('Error:', error.message);
    await sql.end();
    process.exit(1);
  }
}

main();
