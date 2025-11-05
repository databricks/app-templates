import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth';
import { getChatsByUserId, isDatabaseAvailable } from '@chat-template/db';
import { ChatSDKError } from '@chat-template/core/errors';

export const historyRouter: RouterType = Router();

// Apply auth middleware
historyRouter.use(authMiddleware);

/**
 * GET /api/history - Get chat history for authenticated user
 */
historyRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  console.log('[/api/history] Handler called');

  // Return 204 No Content if database is not available
  const dbAvailable = isDatabaseAvailable();
  console.log('[/api/history] Database available:', dbAvailable);

  if (!dbAvailable) {
    console.log('[/api/history] Returning 204 No Content');
    return res.status(204).end();
  }

  const session = req.session;
  if (!session) {
    const error = new ChatSDKError('unauthorized:chat');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  const limit = Number.parseInt((req.query.limit as string) || '10');
  const startingAfter = req.query.starting_after as string | undefined;
  const endingBefore = req.query.ending_before as string | undefined;

  if (startingAfter && endingBefore) {
    const error = new ChatSDKError(
      'bad_request:api',
      'Only one of starting_after or ending_before can be provided.',
    );
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }

  try {
    const chats = await getChatsByUserId({
      id: session.user.id,
      limit,
      startingAfter: startingAfter ?? null,
      endingBefore: endingBefore ?? null,
    });

    res.json(chats);
  } catch (error) {
    console.error('[/api/history] Error in handler:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});
