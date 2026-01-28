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
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'ai_chatbot'
      ORDER BY table_name
    `;
    
    console.log('\n=== Tables in ai_chatbot schema ===');
    for (const table of tables) {
      console.log(`\n${table.table_name}:`);
      const columns = await sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'ai_chatbot' 
        AND table_name = ${table.table_name}
        ORDER BY ordinal_position
      `;
      columns.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type}`);
      });
    }
    
    await sql.end();
  } catch (error: any) {
    console.error('Error:', error.message);
    await sql.end();
    process.exit(1);
  }
}

main();
