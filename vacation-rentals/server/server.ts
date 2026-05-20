import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupWanderbricksRoutes } from './routes/wanderbricks/booking-routes';

createApp({
  plugins: [
    server({ autoStart: false }),
    analytics({}),
    genie({
      spaces: { wanderbricks: process.env.DATABRICKS_GENIE_SPACE_ID ?? '' },
    }),
    lakebase(),
  ],
})
  .then(async (appkit) => {
    await setupWanderbricksRoutes(appkit);
    await appkit.server.start();
  })
  .catch(console.error);
