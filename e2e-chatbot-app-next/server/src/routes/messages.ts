import { Router, type Request, type Response, type Router as RouterType } from 'express';
import { authMiddleware, requireAuth, requireChatAccess } from '../middleware/auth';
import {
  getMessageById,
  deleteMessagesByChatIdAfterTimestamp,
  getMessagesByChatId,
} from '@chat-template/db';

export const messagesRouter: RouterType = Router();

// Apply auth middleware
messagesRouter.use(authMiddleware);

/**
 * GET /api/messages/:id - Get messages by chat ID
 */
messagesRouter.get('/:id', [requireAuth, requireChatAccess], async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return; // handled by middleware

  try {
    const messages = await getMessagesByChatId({ id });
    return res.status(200).json(messages);
  } catch (error) {
    console.error('Error getting messages by chat ID:', error);
    return res.status(500).json({ error: 'Failed to get messages' });
  }
});

/**
 * DELETE /api/messages/:id/trailing - Delete trailing messages after a specific message
 */
messagesRouter.delete(
  '/:id/trailing',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [message] = await getMessageById({ id });

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
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
