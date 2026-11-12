import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupWanderbricksRoutes } from './routes/wanderbricks/booking-routes';
import { csrfMiddleware, securityHeadersMiddleware } from './security';

createApp({
  plugins: [
    analytics({}),
    genie({
      spaces: { wanderbricks: process.env.DATABRICKS_GENIE_SPACE_ID ?? '' },
    }),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    // Runs after AppKit's own plugin routes (/api/<plugin>) are mounted, so it
    // covers the routes registered below and the frontend, not the plugin routes.
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
      app.use(securityHeadersMiddleware);
      app.use(csrfMiddleware);
    });
    await setupWanderbricksRoutes(appkit);
  },
}).catch(console.error);
