import { createApp, lakebase, server } from '@databricks/appkit';
import { setupSampleLakebaseRoutes } from './routes/lakebase/todo-routes';
import { protectServer } from './security';

createApp({
  plugins: [
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
    });
    await setupSampleLakebaseRoutes(appkit);
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
