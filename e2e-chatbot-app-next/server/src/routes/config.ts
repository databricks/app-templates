import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { isDatabaseAvailable } from '@chat-template/db';
import { getEndpointOboScopes } from '@chat-template/ai-sdk-providers';

export const configRouter: RouterType = Router();

/**
 * GET /api/config - Get application configuration
 * Returns feature flags and OBO status based on environment configuration
 */
configRouter.get('/', async (_req: Request, res: Response) => {
  const oboScopes = await getEndpointOboScopes();
  res.json({
    features: {
      chatHistory: isDatabaseAvailable(),
      feedback: !!process.env.MLFLOW_EXPERIMENT_ID,
    },
    obo: {
      enabled: oboScopes.length > 0,
      requiredScopes: oboScopes,
    },
  });
});
