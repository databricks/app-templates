import { createApp, analytics, files, server } from '@databricks/appkit';
import { withinVolume } from './files-policy';
import { protectServer } from './security';
import { setupReviewRoutes } from './routes/review-routes';

createApp({
  plugins: [
    analytics(),
    files({
      volumes: {
        // Key matches the `DATABRICKS_VOLUME_FILES` binding in app.yaml.
        //
        // `auth: 'on-behalf-of-user'` is what makes a page-image read run as the
        // signed-in reviewer, so Unity Catalog applies their own READ VOLUME
        // grant. Without it the plugin reads as the service principal, which
        // would hand every reviewer whatever the SP can see.
        //
        // `withinVolume` keeps a request inside the bound volume: the plugin
        // otherwise resolves any absolute path under /Volumes/ as given.
        // `publicRead()` denies upload, mkdir and delete, which a reviewer
        // never needs: they only ever look at a page.
        files: {
          auth: 'on-behalf-of-user',
          policy: files.policy.all(withinVolume, files.policy.publicRead()),
        },
      },
    }),
    server(),
  ],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.disable('x-powered-by');
    });
    setupReviewRoutes(appkit as unknown as Parameters<typeof setupReviewRoutes>[0]);
  },
})
  .then((appkit) => protectServer(appkit.server.getServer()))
  .catch(console.error);
