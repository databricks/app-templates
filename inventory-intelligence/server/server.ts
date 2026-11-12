import {
  createApp,
  analytics,
  genie,
  lakebase,
  server,
} from "@databricks/appkit";
import { setupInventoryRoutes, genieEnabled } from "./routes/inventory-routes";
import { csrfMiddleware, securityHeadersMiddleware } from "./security";

createApp({
  plugins: [
    analytics(),
    ...(genieEnabled ? [genie()] : []),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    // Runs after AppKit's own plugin routes (/api/<plugin>) are mounted, so it
    // covers the routes registered below and the frontend, not the plugin routes.
    appkit.server.extend((app) => {
      app.disable("x-powered-by");
      app.use(securityHeadersMiddleware);
      app.use(csrfMiddleware);
    });
    await setupInventoryRoutes(appkit);
  },
}).catch(console.error);
