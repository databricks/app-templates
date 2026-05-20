import {
  createApp,
  analytics,
  genie,
  lakebase,
  server,
} from "@databricks/appkit";
import { setupModerationRoutes } from "./routes/moderation-routes";

await createApp({
  plugins: [server(), analytics(), genie(), lakebase()],
  async onPluginsReady(appkit) {
    await setupModerationRoutes(appkit);
  },
});
