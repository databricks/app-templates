import { createApp, analytics, server } from '@databricks/appkit';
import { protectServer } from './security';

createApp({
  plugins: [
    analytics(),
    server(),
  ],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
    });
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
