import { createApp, analytics, files, genie, lakebase, server, serving } from '@databricks/appkit';
import { agents } from '@databricks/appkit/beta';
import { setupSampleLakebaseRoutes } from './routes/lakebase/todo-routes';
import { helper } from './agents/helper';

export const app = createApp({
  // Uses AppKit's existing TelemetryManager / OTel provider. The setup
  // command provisions the immutable UC trace location before first run.
  telemetry: { mlflowUc: true },
  plugins: [
    agents({
      defaultModel: process.env.DATABRICKS_AGENT_SERVING_ENDPOINT_NAME,
      agents: { helper },
    }),
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
});

app.catch(console.error);
