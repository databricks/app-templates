import {
  createApp,
  analytics,
  genie,
  lakebase,
  server,
} from "@databricks/appkit";
import { setupInventoryRoutes, genieEnabled } from "./routes/inventory-routes";

createApp({
  plugins: [
    analytics(),
    ...(genieEnabled ? [genie()] : []),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupInventoryRoutes(appkit);
  },
}).catch(console.error);
