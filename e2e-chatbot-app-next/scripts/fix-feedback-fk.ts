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
    console.log('Dropping old foreign key constraint on Feedback.messageId...');
    await sql`
      ALTER TABLE "ai_chatbot"."Feedback"
      DROP CONSTRAINT IF EXISTS "Feedback_messageId_Message_id_fk"
    `;
    
    console.log('Adding new foreign key constraint to Message_v2...');
    await sql`
      ALTER TABLE "ai_chatbot"."Feedback"
      ADD CONSTRAINT "Feedback_messageId_Message_v2_id_fk"
      FOREIGN KEY ("messageId") REFERENCES "ai_chatbot"."Message_v2"("id")
      ON DELETE CASCADE
    `;
    
    console.log('✓ Successfully updated foreign key constraint');
    
    await sql.end();
  } catch (error: any) {
    console.error('Error:', error.message);
    await sql.end();
    process.exit(1);
  }
}

main();
