import {
  createApp,
  analytics,
  genie,
  lakebase,
  server,
} from "@databricks/appkit";
import { setupInventoryRoutes, genieEnabled } from "./routes/inventory-routes";

await createApp({
  plugins: [
    server(),
    analytics(),
    ...(genieEnabled ? [genie()] : []),
    lakebase(),
  ],
  async onPluginsReady(appkit) {
    await setupInventoryRoutes(appkit);
  },
});
