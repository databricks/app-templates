import { createApp, server, serving } from '@databricks/appkit';

export const app = createApp({
  plugins: [
    server(),
    serving(),
  ],
});

app.catch(console.error);
