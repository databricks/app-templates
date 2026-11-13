import {
  createApp,
  analytics,
  genie,
  lakebase,
  server,
} from "@databricks/appkit";
import { setupModerationRoutes } from "./routes/moderation-routes";
import { protectServer } from "./security";

createApp({
  plugins: [analytics(), genie(), lakebase(), server()],
  async onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable("x-powered-by");
    });
    await setupModerationRoutes(appkit);
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
