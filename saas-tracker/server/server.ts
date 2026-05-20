import {
  createApp,
  analytics,
  genie,
  lakebase,
  server,
} from "@databricks/appkit";
import { setupSaasRoutes } from "./routes/saas-routes";

await createApp({
  plugins: [server(), analytics(), genie(), lakebase()],
  async onPluginsReady(appkit) {
    await setupSaasRoutes(appkit);
  },
});
