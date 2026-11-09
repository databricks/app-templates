import { createApp, analytics, files, genie, lakebase, server, serving } from '@databricks/appkit';
import { setupSampleLakebaseRoutes } from './routes/lakebase/todo-routes';

createApp({
  plugins: [
    analytics(),
    files(),
    genie(),
    lakebase(),
    server(),
    serving(),
  ],
  async onPluginsReady(appkit) {
    await setupSampleLakebaseRoutes(appkit);
  },
}).catch(console.error);
