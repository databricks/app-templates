import { createApp, analytics, files, genie, lakebase, server } from '@databricks/appkit';
import { setupSampleLakebaseRoutes } from './routes/lakebase/todo-routes';

createApp({
  plugins: [
    analytics(),
    files(),
    genie(),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupSampleLakebaseRoutes(appkit);
  },
}).catch(console.error);
