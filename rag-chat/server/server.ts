import { createApp, server, lakebase } from '@databricks/appkit';
import { setupRagTables, insertDocument } from './lib/rag-store';
import { setupChatRoutes } from './routes/chat-routes';
import { setupChatPersistenceRoutes } from './routes/chat-persistence-routes';
import { setupChatTables } from './lib/chat-store';
import { seedFromWikipedia } from './lib/seed-data';
import { generateEmbedding } from './lib/embeddings';

await createApp({
  plugins: [server(), lakebase()],
  async onPluginsReady(appkit) {
    await setupRagTables(appkit);
    await setupChatTables(appkit);
    await seedFromWikipedia(appkit, generateEmbedding, insertDocument);
    setupChatRoutes(appkit);
    setupChatPersistenceRoutes(appkit);
  },
});
