import { Router, type Request, type Response, type Router as RouterType } from 'express';
import { authMiddleware } from '../middleware/auth';
import type { ClientSession } from '@chat-template/auth';

export const sessionRouter: RouterType = Router();

// Apply auth middleware
sessionRouter.use(authMiddleware);

/**
 * GET /api/session - Get current user session
 */
sessionRouter.get('/', async (req: Request, res: Response) => {
  console.log('[SESSION] Headers:', {
    'x-forwarded-user': req.headers['x-forwarded-user'],
    'x-forwarded-email': req.headers['x-forwarded-email'],
    'x-forwarded-preferred-username': req.headers['x-forwarded-preferred-username'],
  });
  console.log('[SESSION] req.session:', JSON.stringify(req.session, null, 2));
  const session = req.session;

  if (!session?.user) {
    console.log('[SESSION] No user in session, returning null');
    return res.json({ user: null } as ClientSession);
  }

  // Return minimal user data for client
  const clientSession: ClientSession = {
    user: {
      email: session.user.email,
      name: session.user.name,
      preferredUsername: session.user.preferredUsername,
    },
  };

  console.log('[SESSION] Returning session:', JSON.stringify(clientSession, null, 2));
  res.json(clientSession);
});
