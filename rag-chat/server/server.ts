import { createApp, server, lakebase } from '@databricks/appkit';
import { setupRagTables, insertDocument } from './lib/rag-store';
import { setupChatRoutes } from './routes/chat-routes';
import { setupChatPersistenceRoutes } from './routes/chat-persistence-routes';
import { setupChatTables } from './lib/chat-store';
import { seedFromWikipedia } from './lib/seed-data';
import { generateEmbedding } from './lib/embeddings';

createApp({
  plugins: [lakebase(), server()],
  async onPluginsReady(appkit) {
    await setupRagTables(appkit);
    await setupChatTables(appkit);
    setupChatRoutes(appkit);
    setupChatPersistenceRoutes(appkit);
    // Kick off the Wikipedia seed without awaiting so a slow/blocked egress
    // fetch can't delay route registration or trip the deploy health-check.
    void seedFromWikipedia(appkit, generateEmbedding, insertDocument).catch(
      (e) => console.warn('[rag] seed failed:', (e as Error)?.message),
    );
  },
}).catch(console.error);
