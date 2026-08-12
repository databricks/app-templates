import { createApp, server } from '@databricks/appkit';
import { agents } from '@databricks/appkit/beta';
import { helper } from './agents/helper';

createApp({
  // Uses AppKit's existing TelemetryManager / OTel provider. The setup
  // command provisions the immutable UC trace location before first run.
  telemetry: { mlflowUc: true },
  plugins: [
    agents({ agents: { helper } }),
    server(),
  ],
}).catch(console.error);
