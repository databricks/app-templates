import { createApp, genie, server } from '@databricks/appkit';

export const app = createApp({
  plugins: [
    genie(),
    server(),
  ],
});

app.catch(console.error);
