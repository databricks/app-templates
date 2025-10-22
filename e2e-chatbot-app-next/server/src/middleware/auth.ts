import type { Request, Response, NextFunction } from 'express';
import {
  getAuthSession,
  type AuthSession,
} from '../shared/databricks/auth/databricks-auth';
import { ChatSDKError } from '../shared/lib/errors';

// Extend Express Request type to include session
declare global {
  namespace Express {
    interface Request {
      session?: AuthSession;
    }
  }
}

/**
 * Middleware to authenticate requests and attach session to request object
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    // Create a minimal Request-like object for getAuthSession
    const requestLike = {
      headers: {
        get: (name: string) => req.headers[name.toLowerCase()] as string | null,
      },
    };

    const session = await getAuthSession(requestLike as any);
    req.session = session || undefined;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    next(error);
  }
}

/**
 * Middleware to require authentication - returns 401 if no session
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    const response = new ChatSDKError('unauthorized:chat').toResponse();
    return res.status(response.status).json(response.json);
  }
  next();
}
