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
    const chats = await sql`
      SELECT id, title, "userId"
      FROM ai_chatbot."Chat"
      ORDER BY "createdAt" DESC
      LIMIT 5
    `;
    
    console.log('Recent chats:');
    chats.forEach(chat => {
      console.log(`  ID: ${chat.id}`);
      console.log(`  Title: ${chat.title}`);
      console.log(`  User: ${chat.userId}`);
      console.log('  ---');
    });
    
    if (chats.length > 0) {
      console.log(`\nTest with: curl -H "X-Forwarded-User: ${chats[0].userId}" http://localhost:3001/api/feedback/chat/${chats[0].id}`);
    }
    
    await sql.end();
  } catch (error: any) {
    console.error('Error:', error.message);
    await sql.end();
    process.exit(1);
  }
}

main();
