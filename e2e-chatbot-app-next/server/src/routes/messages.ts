import { Router, type Request, type Response } from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth';
import {
  getMessageById,
  deleteMessagesByChatIdAfterTimestamp,
} from '../shared/databricks/db/queries';

export const messagesRouter = Router();

// Apply auth middleware
messagesRouter.use(authMiddleware);

/**
 * DELETE /api/messages/:id/trailing - Delete trailing messages after a specific message
 */
messagesRouter.delete(
  '/:id/trailing',
  requireAuth,
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
