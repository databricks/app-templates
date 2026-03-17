import { createApp, analytics, server } from '@databricks/appkit';

createApp({
  plugins: [
    analytics(),
    server(),
  ],
})
  .catch(console.error);
