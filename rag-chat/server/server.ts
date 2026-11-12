// diagnostics bootstrap: install crash/exception logging before any other import
import './diagnostics';
import { createApp, server, lakebase } from '@databricks/appkit';
import { setupRagTables, insertDocument } from './lib/rag-store';
import { setupChatRoutes } from './routes/chat-routes';
import { setupChatPersistenceRoutes } from './routes/chat-persistence-routes';
import { setupChatTables } from './lib/chat-store';
import { seedFromWikipedia } from './lib/seed-data';
import { generateEmbedding } from './lib/embeddings';
import { csrfMiddleware, securityHeadersMiddleware } from './security';

createApp({
  plugins: [lakebase(), server()],
  async onPluginsReady(appkit) {
    // Runs after AppKit's own plugin routes (/api/<plugin>) are mounted, so it
    // covers the routes registered below and the frontend, not the plugin routes.
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
      app.use(securityHeadersMiddleware);
      app.use(csrfMiddleware);
    });
    await setupRagTables(appkit);
    await setupChatTables(appkit);
    setupChatRoutes(appkit);
    setupChatPersistenceRoutes(appkit);
    void seedFromWikipedia(appkit, generateEmbedding, insertDocument).catch((e) =>
      console.warn('[rag] seed failed:', (e as Error).message)
    );
  },
}).catch(console.error);
