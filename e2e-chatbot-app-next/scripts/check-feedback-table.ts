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
    const result = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'ai_chatbot'
      ORDER BY table_name
    `;
    
    console.log('\nTables in ai_chatbot schema:');
    result.forEach(row => console.log('  -', row.table_name));
    
    const hasFeedback = result.some(r => r.table_name === 'Feedback');
    console.log('\nFeedback table exists:', hasFeedback);
    
    await sql.end();
  } catch (error: any) {
    console.error('Error:', error.message);
    await sql.end();
    process.exit(1);
  }
}

main();
