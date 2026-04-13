import { createApp, analytics, files, genie, lakebase, server, serving } from '@databricks/appkit';
import { setupSampleLakebaseRoutes } from './routes/lakebase/todo-routes';

createApp({
  plugins: [
    server({ autoStart: false }),
    analytics(),
    files(),
    genie(),
    lakebase(),
    serving(),
  ],
})
  .then(async (appkit) => {
    await setupSampleLakebaseRoutes(appkit);
    await appkit.server.start();
  })
  .catch(console.error);
