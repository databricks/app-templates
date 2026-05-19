import { createApp, server, serving } from '@databricks/appkit';

createApp({
  plugins: [
    server(),
    serving(),
  ],
})
  .catch(console.error);
