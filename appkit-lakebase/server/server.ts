import { createApp, lakebase, server } from '@databricks/appkit';
import { setupSampleLakebaseRoutes } from './routes/lakebase/todo-routes';

export const app = createApp({
  plugins: [
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupSampleLakebaseRoutes(appkit);
  },
});

app.catch(console.error);
