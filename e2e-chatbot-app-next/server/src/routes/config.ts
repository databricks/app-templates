import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { isDatabaseAvailable } from '@chat-template/db';
import { getEndpointOboInfo } from '@chat-template/ai-sdk-providers';

export const configRouter: RouterType = Router();

/**
 * Decode a JWT payload without verification (just reads claims).
 * Returns the parsed payload or null if decoding fails.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const decoded = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * GET /api/config - Get application configuration
 * Returns feature flags and OBO status based on environment configuration.
 * If the user's OBO token is present, decodes it to check which required
 * scopes are missing — the banner only shows missing scopes.
 */
configRouter.get('/', async (req: Request, res: Response) => {
  const oboInfo = await getEndpointOboInfo();

  let missingScopes = oboInfo.requiredScopes;

  // If the user has an OBO token, check which scopes are already present
  const userToken = req.headers['x-forwarded-access-token'] as string | undefined;
  if (userToken && oboInfo.enabled) {
    const payload = decodeJwtPayload(userToken);
    if (payload) {
      // Databricks OAuth tokens use 'scope' (space-separated string)
      const tokenScopes = typeof payload.scope === 'string'
        ? payload.scope.split(' ')
        : Array.isArray(payload.scp) ? payload.scp as string[] : [];
      // A required scope like "sql.statement-execution" is satisfied by
      // an exact match OR by its parent prefix (e.g. "sql")
      missingScopes = oboInfo.requiredScopes.filter(required => {
        const parent = required.split('.')[0];
        return !tokenScopes.some(ts => ts === required || ts === parent);
      });
    }
  }

  res.json({
    features: {
      chatHistory: isDatabaseAvailable(),
      feedback: !!process.env.MLFLOW_EXPERIMENT_ID,
    },
    obo: {
      enabled: oboInfo.enabled,
      requiredScopes: oboInfo.requiredScopes,
      missingScopes,
      isSupervisorAgent: oboInfo.isSupervisorAgent,
    },
  });
});
