import { createApp, server, serving } from '@databricks/appkit';
import { csrfMiddleware, securityHeadersMiddleware } from './security';

createApp({
  plugins: [
    server(),
    serving(),
  ],
  onPluginsReady(appkit) {
    // Runs after AppKit's own plugin routes (/api/<plugin>) are mounted, so it
    // covers routes registered here and the frontend, not the plugin routes.
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
      app.use(securityHeadersMiddleware);
      app.use(csrfMiddleware);
    });
  },
}).catch(console.error);
