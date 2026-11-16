import { createApp, analytics, files, server } from '@databricks/appkit';
import { setupReviewRoutes } from './routes/review-routes';

createApp({
  plugins: [analytics(), files(), server()],
  onPluginsReady(appkit) {
    setupReviewRoutes(appkit as unknown as Parameters<typeof setupReviewRoutes>[0]);
  },
}).catch(console.error);
