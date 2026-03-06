import { createApp, analytics, server } from '@databricks/appkit';

createApp({
  plugins: [
    analytics(),
    server(),
  ],
}).then(async (appkit) => {
}).catch(console.error);
