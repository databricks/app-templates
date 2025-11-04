import type { Request, Response, NextFunction } from 'express';
import { getAuthSession, type AuthSession } from '@chat-template/auth';
import { checkChatAccess } from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';

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
    const session = await getAuthSession({
      getRequestHeader: (name: string) =>
        req.headers[name.toLowerCase()] as string | null,
    });
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

export async function requireChatAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { id } = req.params;
  if (!id) {
    console.error(
      'Chat access middleware error: no chat ID provided',
      req.params,
    );
    const error = new ChatSDKError('bad_request:api');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }
  const { allowed, reason } = await checkChatAccess(id, req.session?.user.id);
  if (!allowed) {
    console.error(
      'Chat access middleware error: user does not have access to chat',
      reason,
    );
    const error = new ChatSDKError('forbidden:chat', reason);
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }
  next();
}
