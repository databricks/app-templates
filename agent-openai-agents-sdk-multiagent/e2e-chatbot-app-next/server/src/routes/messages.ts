import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import {
  authMiddleware,
  requireAuth,
  requireChatAccess,
  getIdFromRequest,
} from '../middleware/auth';
import {
  getMessageById,
  deleteMessagesByChatIdAfterTimestamp,
  getMessagesByChatId,
  isDatabaseAvailable,
} from '@chat-template/db';
import { ChatSDKError, checkChatAccess } from '@chat-template/core';

export const messagesRouter: RouterType = Router();

// Apply auth middleware
messagesRouter.use(authMiddleware);

/**
 * GET /api/messages/:id - Get messages by chat ID
 */
messagesRouter.get(
  '/:id',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    const id = getIdFromRequest(req);
    if (!id) return;

    try {
      const messages = await getMessagesByChatId({ id });
      return res.status(200).json(messages);
    } catch (error) {
      console.error('Error getting messages by chat ID:', error);
      return res.status(500).json({ error: 'Failed to get messages' });
    }
  },
);

/**
 * DELETE /api/messages/:id/trailing - Delete trailing messages after a specific message
 */
messagesRouter.delete(
  '/:id/trailing',
  [requireAuth],
  async (req: Request, res: Response) => {
    try {
      // Return 204 No Content if database is not available
      const dbAvailable = isDatabaseAvailable();
      console.log(
        '[/api/messages/:id/trailing] Database available:',
        dbAvailable,
      );

      if (!dbAvailable) {
        console.log('[/api/messages/:id/trailing] Returning 204 No Content');
        return res.status(204).end();
      }

      const id = getIdFromRequest(req);
      if (!id) return;
      const [message] = await getMessageById({ id });

      if (!message) {
        const messageError = new ChatSDKError('not_found:message');
        const response = messageError.toResponse();
        return res.status(response.status).json(response.json);
      }

      const { allowed, reason } = await checkChatAccess(
        message.chatId,
        req.session?.user.id,
      );

      if (!allowed) {
        const chatError = new ChatSDKError('forbidden:chat', reason);
        const response = chatError.toResponse();
        return res.status(response.status).json(response.json);
      }

      await deleteMessagesByChatIdAfterTimestamp({
        chatId: message.chatId,
        timestamp: message.createdAt,
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting trailing messages:', error);
      res.status(500).json({ error: 'Failed to delete messages' });
    }
  },
);
