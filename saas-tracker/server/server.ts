import {
  createApp,
  analytics,
  genie,
  lakebase,
  server,
} from "@databricks/appkit";
import { setupSaasRoutes } from "./routes/saas-routes";

createApp({
  plugins: [analytics(), genie(), lakebase(), server()],
  async onPluginsReady(appkit) {
    await setupSaasRoutes(appkit);
  },
}).catch(console.error);
