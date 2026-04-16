import { createApp, files, server } from '@databricks/appkit';

createApp({
  plugins: [
    files(),
    server(),
  ],
})
  .catch(console.error);
