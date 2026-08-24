import { createApp, server, lakebase } from '@databricks/appkit';
import { initializeRagServices, validateTracingEnvironment } from './lib/tracing';

// Fail before AppKit constructs or starts its HTTP server when UC tracing is incomplete.
validateTracingEnvironment();

createApp({
  telemetry: { mlflowUc: true } as NonNullable<Parameters<typeof createApp>[0]>['telemetry'],
  plugins: [lakebase(), server()],
  async onPluginsReady(appkit) {
    await initializeRagServices(appkit);
  },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
