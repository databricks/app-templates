import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { z } from 'zod';
import {
  authMiddleware,
  requireAuth,
  requireChatAccess,
} from '../middleware/auth';
import {
  createFeedback,
  getFeedbackByMessageId,
  updateFeedback,
  deleteFeedback,
  getMessageById,
  isDatabaseAvailable,
} from '@chat-template/db';
import { ChatSDKError } from '@chat-template/core';
import { submitToMLflow } from '../utils/mlflow-client';

export const feedbackRouter: RouterType = Router();

// Apply auth middleware
feedbackRouter.use(authMiddleware);

// Request validation schemas
const createFeedbackSchema = z.object({
  messageId: z.string().uuid(),
  chatId: z.string().uuid(),
  feedbackType: z.enum(['thumbs_up', 'thumbs_down']),
});

const updateFeedbackSchema = z.object({
  feedbackType: z.enum(['thumbs_up', 'thumbs_down']).optional(),
});

/**
 * POST /api/feedback - Create new feedback
 */
feedbackRouter.post(
  '/',
  [requireAuth, requireChatAccess],
  async (req: Request, res: Response) => {
    try {
      // Validate request body
      const validationResult = createFeedbackSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: validationResult.error.format(),
        });
      }

      const { messageId, chatId, feedbackType } = validationResult.data;
      const userId = req.session?.user.id;

      if (!userId) {
        const error = new ChatSDKError('unauthorized:auth');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }

      // Check if feedback already exists for this message
      const existingFeedback = await getFeedbackByMessageId({ messageId });

      if (existingFeedback) {
        // Update existing feedback
        const updated = await updateFeedback({
          id: existingFeedback.id,
          feedbackType,
        });

        // Submit to MLflow asynchronously (don't wait for response)
        if (updated) {
          submitToMLflow({
            messageId,
            chatId,
            userId,
            feedbackType,
            assessmentId: updated.mlflowAssessmentId || undefined,
          }).catch((error) => {
            console.error('[Feedback] Failed to submit to MLflow:', error);
          });
        }

        return res.status(200).json(updated);
      }

      // Create new feedback
      const feedback = await createFeedback({
        messageId,
        chatId,
        userId,
        feedbackType,
      });

      // Submit to MLflow asynchronously (don't wait for response)
      if (feedback) {
        submitToMLflow({
          messageId,
          chatId,
          userId,
          feedbackType,
        }).catch((error) => {
          console.error('[Feedback] Failed to submit to MLflow:', error);
        });
      }

      return res.status(201).json(feedback);
    } catch (error) {
      console.error('[Feedback] Error creating feedback:', error);
      if (error instanceof ChatSDKError) {
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
      return res.status(500).json({ error: 'Failed to create feedback' });
    }
  },
);

/**
 * GET /api/feedback/message/:messageId - Get feedback by message ID
 */
feedbackRouter.get(
  '/message/:messageId',
  [requireAuth],
  async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params;

      if (!messageId) {
        return res.status(400).json({ error: 'Message ID is required' });
      }

      // Get the message to verify chat access
      const [message] = await getMessageById({ id: messageId });
      if (!message) {
        const error = new ChatSDKError('not_found:message');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }

      const feedback = await getFeedbackByMessageId({ messageId });

      if (!feedback) {
        return res.status(404).json({ error: 'Feedback not found' });
      }

      return res.status(200).json(feedback);
    } catch (error) {
      console.error('[Feedback] Error getting feedback:', error);
      if (error instanceof ChatSDKError) {
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
      return res.status(500).json({ error: 'Failed to get feedback' });
    }
  },
);

/**
 * PUT /api/feedback/:id - Update feedback
 */
feedbackRouter.put(
  '/:id',
  [requireAuth],
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'Feedback ID is required' });
      }

      // Validate request body
      const validationResult = updateFeedbackSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: validationResult.error.format(),
        });
      }

      const { feedbackType } = validationResult.data;

      const updated = await updateFeedback({
        id,
        feedbackType,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Feedback not found' });
      }

      return res.status(200).json(updated);
    } catch (error) {
      console.error('[Feedback] Error updating feedback:', error);
      if (error instanceof ChatSDKError) {
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
      return res.status(500).json({ error: 'Failed to update feedback' });
    }
  },
);

/**
 * DELETE /api/feedback/:id - Delete feedback
 */
feedbackRouter.delete(
  '/:id',
  [requireAuth],
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'Feedback ID is required' });
      }

      // If database is not available, return 204
      if (!isDatabaseAvailable()) {
        return res.status(204).end();
      }

      const deleted = await deleteFeedback({ id });

      if (!deleted) {
        return res.status(404).json({ error: 'Feedback not found' });
      }

      return res.status(204).end();
    } catch (error) {
      console.error('[Feedback] Error deleting feedback:', error);
      if (error instanceof ChatSDKError) {
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
      return res.status(500).json({ error: 'Failed to delete feedback' });
    }
  },
);
