import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupSupportRoutes } from './routes/support-routes';

await createApp({
  plugins: [server(), analytics(), genie(), lakebase()],
  async onPluginsReady(appkit) {
    await setupSupportRoutes(appkit);
  },
});
