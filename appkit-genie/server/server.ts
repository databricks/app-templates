import { createApp, genie, server } from '@databricks/appkit';
import { protectServer } from './security';

createApp({
  plugins: [
    genie(),
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
