import { createApp, files, server } from '@databricks/appkit';
import { withinVolume } from './files-policy';
import { protectServer } from './security';

createApp({
  plugins: [
    files({
      volumes: {
        // publicRead() is AppKit's default policy, which denies upload, mkdir and delete;
        // use files.policy.all(withinVolume, files.policy.allowAll()) to enable them.
        files: { policy: files.policy.all(withinVolume, files.policy.publicRead()) },
      },
    }),
    server(),
  ],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
    });
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
