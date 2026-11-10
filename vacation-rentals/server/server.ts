import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupWanderbricksRoutes } from './routes/wanderbricks/booking-routes';

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
    await setupWanderbricksRoutes(appkit);
  },
}).catch(console.error);
