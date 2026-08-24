import { createApp, files, server } from '@databricks/appkit';

export const app = createApp({
  plugins: [
    files(),
    server(),
  ],
});

app.catch(console.error);
