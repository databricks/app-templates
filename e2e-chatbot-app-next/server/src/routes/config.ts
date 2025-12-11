import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { isDatabaseAvailable } from '@chat-template/db';
import { getCachedCliHost } from '@chat-template/auth';
import { getHostUrl } from '@chat-template/utils';

export const configRouter: RouterType = Router();

/**
 * GET /api/config - Get application configuration
 * Returns feature flags based on environment configuration
 */
configRouter.get('/', (_req: Request, res: Response) => {
  // Get Databricks workspace URL
  let workspaceUrl = getCachedCliHost();
  if (!workspaceUrl) {
    workspaceUrl = getHostUrl();
  }

  res.json({
    features: {
      chatHistory: isDatabaseAvailable(),
    },
    workspaceUrl,
  });
});
