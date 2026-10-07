import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { isDatabaseAvailable } from '@chat-template/db';

export const configRouter: RouterType = Router();

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
  });
});
