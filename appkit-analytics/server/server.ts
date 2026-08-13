import { createApp, analytics, server } from '@databricks/appkit';

export const app = createApp({
  plugins: [
    analytics(),
    server(),
  ],
});

app.catch(console.error);
