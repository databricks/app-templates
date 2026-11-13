import { createApp, analytics, files, genie, lakebase, server, serving } from '@databricks/appkit';
import { setupSampleLakebaseRoutes } from './routes/lakebase/todo-routes';
import { withinVolume } from './files-policy';
import { protectServer } from './security';

createApp({
  plugins: [
    analytics(),
    files({
      volumes: {
        // publicRead() is AppKit's default policy, which denies upload, mkdir and delete;
        // use files.policy.all(withinVolume, files.policy.allowAll()) to enable them.
        files: { policy: files.policy.all(withinVolume, files.policy.publicRead()) },
      },
    }),
    genie(),
    lakebase(),
    server(),
    serving(),
  ],
  async onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
    });
    await setupSampleLakebaseRoutes(appkit);
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
