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
    const users = await sql`
      SELECT id, email FROM "ai_chatbot"."User"
      WHERE id = '4348780779818708'
    `;
    
    if (users.length > 0) {
      console.log('✓ User was automatically created:');
      console.log('  ID:', users[0].id);
      console.log('  Email:', users[0].email);
    } else {
      console.log('✗ User does not exist');
    }
    
    await sql.end();
  } catch (error: any) {
    console.error('Error:', error.message);
    await sql.end();
    process.exit(1);
  }
}

main();
