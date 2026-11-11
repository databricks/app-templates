import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupSupportRoutes } from './routes/support-routes';
import { csrfMiddleware, securityHeadersMiddleware } from './security';

createApp({
  plugins: [analytics(), genie(), lakebase(), server()],
  async onPluginsReady(appkit) {
    // Runs after AppKit's own plugin routes (/api/<plugin>) are mounted, so it
    // covers the routes registered below and the frontend, not the plugin routes.
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
      app.use(securityHeadersMiddleware);
      app.use(csrfMiddleware);
    });
    await setupSupportRoutes(appkit);
  },
}).catch(console.error);
