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
    const constraints = await sql`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'ai_chatbot'
        AND tc.table_name IN ('Chat', 'Feedback')
      ORDER BY tc.table_name, tc.constraint_name
    `;
    
    console.log('\n=== Foreign Key Constraints ===');
    constraints.forEach(c => {
      console.log(`${c.table_name}.${c.column_name} -> ${c.foreign_table_name}.${c.foreign_column_name}`);
      console.log(`  Constraint: ${c.constraint_name}`);
      console.log('');
    });
    
    await sql.end();
  } catch (error: any) {
    console.error('Error:', error.message);
    await sql.end();
    process.exit(1);
  }
}

main();
