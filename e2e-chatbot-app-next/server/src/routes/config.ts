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
 * Extract OAuth scopes from a JWT token (without verification).
 * Databricks tokens use 'scope' (space-separated string) or 'scp' (array).
 */
function getScopesFromToken(token: string): string[] {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return [];
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    if (typeof payload.scope === 'string') return payload.scope.split(' ');
    if (Array.isArray(payload.scp)) return payload.scp as string[];
    return [];
  } catch {
    return [];
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

  let missingScopes = oboInfo.endpointRequiredScopes;

  // If the user has an OBO token, check which scopes are already present
  const userToken = req.headers['x-forwarded-access-token'] as string | undefined;
  if (userToken && oboInfo.isEndpointOboEnabled) {
    const tokenScopes = getScopesFromToken(userToken);
    // A required scope like "sql.statement-execution" is satisfied by
    // an exact match OR by its parent prefix (e.g. "sql")
    missingScopes = oboInfo.endpointRequiredScopes.filter(required => {
      const parent = required.split('.')[0];
      return !tokenScopes.some(ts => ts === required || ts === parent);
    });
  }

  res.json({
    features: {
      chatHistory: isDatabaseAvailable(),
      feedback: !!process.env.MLFLOW_EXPERIMENT_ID,
    },
    obo: {
      isEndpointOboEnabled: oboInfo.isEndpointOboEnabled,
      endpointRequiredScopes: oboInfo.endpointRequiredScopes,
      missingScopes,
      isSupervisorAgent: oboInfo.isSupervisorAgent,
    },
  });
});
