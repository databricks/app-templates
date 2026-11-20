import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { isDatabaseAvailable } from '@databricks/chatbot-db';

export const configRouter: RouterType = Router();

// Host of the Databricks workspace (e.g. "dbc-123.cloud.databricks.com"),
// used by the client to decide which login links it may open.
function getWorkspaceHost(): string | undefined {
  const host = process.env.DATABRICKS_HOST;
  if (!host) return undefined;
  try {
    return new URL(
      /^https?:\/\//.test(host) ? host : `https://${host}`,
    ).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * GET /api/config - Get application configuration
 * Returns feature flags and the empty-state greeting based on environment
 * configuration.
 */
configRouter.get('/', async (_req: Request, res: Response) => {
  res.json({
    features: {
      chatHistory: isDatabaseAvailable(),
      feedback: !!process.env.MLFLOW_EXPERIMENT_ID,
    },
    greeting: process.env.CHAT_GREETING || undefined,
    workspaceHost: getWorkspaceHost(),
  });
});
