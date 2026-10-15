import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupSupportRoutes } from './routes/support-routes';

createApp({
  plugins: [analytics(), genie(), lakebase(), server()],
  async onPluginsReady(appkit) {
    await setupSupportRoutes(appkit);
  },
}).catch(console.error);
