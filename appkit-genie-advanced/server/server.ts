import { createApp, genie, server } from '@databricks/appkit';
import { genieAdvanced } from './plugins/genie-advanced.js';

const spaces = parseSpacesEnv(
  process.env.GENIE_SPACES,
  process.env.DATABRICKS_GENIE_SPACE_ID,
);

createApp({
  plugins: [
    server(),
    genie(spaces ? { spaces } : {}),
    genieAdvanced(spaces ? { spaces } : {}),
  ],
}).catch(console.error);

function parseSpacesEnv(
  raw: string | undefined,
  fallbackSpaceId: string | undefined,
): Record<string, string> | undefined {
  if (raw) {
    const out: Record<string, string> = {};
    for (const pair of raw.split(',')) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const alias = trimmed.slice(0, eq).trim();
      const id = trimmed.slice(eq + 1).trim();
      if (alias && id) out[alias] = id;
    }
    if (Object.keys(out).length > 0) return out;
  }
  if (fallbackSpaceId) return { default: fallbackSpaceId };
  return undefined;
}
