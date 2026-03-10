import { createApp, genie, server } from '@databricks/appkit';

createApp({
  plugins: [
    genie(),
    server(),
  ],
})
  .catch(console.error);
