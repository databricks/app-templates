import {
  createApp,
  analytics,
  genie,
  lakebase,
  server,
} from "@databricks/appkit";
import { setupInventoryRoutes, genieEnabled } from "./routes/inventory-routes";
import { protectServer } from "./security";

createApp({
  plugins: [
    analytics(),
    ...(genieEnabled ? [genie()] : []),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable("x-powered-by");
    });
    await setupInventoryRoutes(appkit);
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
