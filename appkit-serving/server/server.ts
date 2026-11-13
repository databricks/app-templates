import { createApp, server, serving } from '@databricks/appkit';
import { protectServer } from './security';

createApp({
  plugins: [
    server(),
    serving(),
  ],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
    });
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
