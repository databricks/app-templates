// diagnostics bootstrap: install crash/exception logging before any other import
import './diagnostics';
import { createApp, server, lakebase } from '@databricks/appkit';
import { setupRagTables, insertDocument } from './lib/rag-store';
import { setupChatRoutes } from './routes/chat-routes';
import { setupChatPersistenceRoutes } from './routes/chat-persistence-routes';
import { setupChatTables } from './lib/chat-store';
import { seedFromWikipedia } from './lib/seed-data';
import { generateEmbedding } from './lib/embeddings';
import { protectServer } from './security';

createApp({
  plugins: [lakebase(), server()],
  async onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
    });
    await setupRagTables(appkit);
    await setupChatTables(appkit);
    setupChatRoutes(appkit);
    setupChatPersistenceRoutes(appkit);
    void seedFromWikipedia(appkit, generateEmbedding, insertDocument).catch((e) =>
      console.warn('[rag] seed failed:', (e as Error).message)
    );
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
