import { createApp, server } from '@databricks/appkit';
import { designer } from './plugins/designer';

await createApp({ plugins: [designer(), server()] });
