import {
  createApp,
  analytics,
  genie,
  lakebase,
  server,
} from "@databricks/appkit";
import { setupModerationRoutes } from "./routes/moderation-routes";

createApp({
  plugins: [analytics(), genie(), lakebase(), server()],
  async onPluginsReady(appkit) {
    await setupModerationRoutes(appkit);
  },
}).catch(console.error);
