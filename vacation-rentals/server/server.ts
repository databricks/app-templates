import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupWanderbricksRoutes } from './routes/wanderbricks/booking-routes';
import { protectServer } from './security';

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
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
    });
    await setupWanderbricksRoutes(appkit);
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
