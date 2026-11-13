import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupSupportRoutes } from './routes/support-routes';
import { protectServer } from './security';

createApp({
  plugins: [analytics(), genie(), lakebase(), server()],
  async onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
    });
    await setupSupportRoutes(appkit);
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
