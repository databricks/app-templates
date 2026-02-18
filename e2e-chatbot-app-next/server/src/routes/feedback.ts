import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth';
import {
  getMessageById,
  createFeedback,
  getFeedbackByMessageId,
  updateFeedback,
  isDatabaseAvailable,
} from '@chat-template/db';
import { ChatSDKError } from '@chat-template/core/errors';
import { getDatabricksToken } from '@chat-template/auth';
import { getWorkspaceHostname } from '@chat-template/ai-sdk-providers';
import { getMessageMeta } from '../lib/message-meta-store';

export const feedbackRouter: RouterType = Router();

feedbackRouter.use(authMiddleware);

/**
 * POST /api/feedback - Submit feedback for a message
 *
 * Body:
 * - messageId: string - The ID of the message to provide feedback for
 * - feedbackType: 'thumbs_up' | 'thumbs_down' - The type of feedback
 */
feedbackRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { messageId, feedbackType } = req.body;

    if (!messageId || !feedbackType) {
      const error = new ChatSDKError('bad_request:api');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    if (feedbackType !== 'thumbs_up' && feedbackType !== 'thumbs_down') {
      const error = new ChatSDKError('bad_request:api');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const session = req.session;
    if (!session) {
      const error = new ChatSDKError('unauthorized:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Get the message to retrieve traceId and chatId
    const messages = await getMessageById({ id: messageId });
    let traceId: string | null;
    let chatId: string;

    if (!messages || messages.length === 0) {
      // Fall back to in-memory store (ephemeral mode or DB unavailable)
      const meta = getMessageMeta(messageId);
      if (!meta) {
        const error = new ChatSDKError('not_found:database');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
      traceId = meta.traceId;
      chatId = meta.chatId;
    } else {
      const dbMessage = messages[0];
      traceId = dbMessage.traceId;
      chatId = dbMessage.chatId;
    }

    let mlflowAssessmentId: string | undefined;

    // Submit to MLflow if we have a trace ID
    if (traceId) {
      try {
        const token = await getDatabricksToken();
        const hostUrl = await getWorkspaceHostname();

        // MLflow Assessments REST API v3.0:
        //   POST /api/3.0/mlflow/traces/{trace_id}/assessments
        //   Body: { assessment: { trace_id, assessment_name, source, feedback } }
        const mlflowResponse = await fetch(
          `${hostUrl}/api/3.0/mlflow/traces/${traceId}/assessments`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              assessment: {
                trace_id: traceId,
                assessment_name: 'user_feedback',
                source: {
                  source_type: 'HUMAN',
                  source_id: session.user.id,
                },
                feedback: {
                  value: feedbackType === 'thumbs_up',
                },
              },
            }),
          },
        );

        if (!mlflowResponse.ok) {
          const errorText = await mlflowResponse.text();
          console.error('Failed to submit feedback to MLflow:', errorText);
        } else {
          const mlflowResult = await mlflowResponse.json();
          mlflowAssessmentId = mlflowResult.assessment?.assessment_id;
          console.log('Successfully submitted feedback to MLflow:', mlflowAssessmentId);
        }
      } catch (error) {
        console.error('Error submitting feedback to MLflow:', error);
        // Continue to save feedback in database even if MLflow submission fails
      }
    } else {
      console.warn('Message does not have a trace ID, skipping MLflow submission');
    }

    // Save feedback to DB when available
    let feedbackResult;
    if (isDatabaseAvailable()) {
      const existingFeedback = await getFeedbackByMessageId({ messageId });
      if (existingFeedback) {
        feedbackResult = await updateFeedback({
          id: existingFeedback.id,
          feedbackType,
          mlflowAssessmentId,
        });
      } else {
        feedbackResult = await createFeedback({
          messageId,
          chatId,
          userId: session.user.id,
          feedbackType,
          mlflowAssessmentId,
        });
      }
    }

    return res.status(200).json({
      success: true,
      feedback: feedbackResult ?? null,
      mlflowAssessmentId,
    });
  } catch (error) {
    console.error('[Feedback] Error submitting feedback:', error);

    if (error instanceof ChatSDKError) {
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    const chatError = new ChatSDKError('offline:chat');
    const response = chatError.toResponse();
    return res.status(response.status).json(response.json);
  }
});

/**
 * GET /api/feedback/:messageId - Get feedback for a message
 */
feedbackRouter.get(
  '/:messageId',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params;

      const feedback = await getFeedbackByMessageId({ messageId });

      return res.status(200).json({
        feedback: feedback || null,
      });
    } catch (error) {
      console.error('[Feedback] Error getting feedback:', error);

      if (error instanceof ChatSDKError) {
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }

      const chatError = new ChatSDKError('offline:chat');
      const response = chatError.toResponse();
      return res.status(response.status).json(response.json);
    }
  },
);
