import { createApp, genie, server } from '@databricks/appkit';

createApp({
  plugins: [
    genie(),
    server(),
  ],
}).then(async (appkit) => {
}).catch(console.error);
