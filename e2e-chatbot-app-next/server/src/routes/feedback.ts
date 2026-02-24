import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth';
import { getMessageById, getMessagesByChatId } from '@chat-template/db';
import { ChatSDKError } from '@chat-template/core/errors';
import { getDatabricksToken } from '@chat-template/auth';
import { getWorkspaceHostname } from '@chat-template/ai-sdk-providers';
import {
  getMessageMeta,
  getAssessmentId,
  storeAssessmentId,
} from '../lib/message-meta-store';

export const feedbackRouter: RouterType = Router();

feedbackRouter.use(authMiddleware);

/**
 * Fetch the user's assessment for a specific trace from MLflow.
 * Returns null if no matching assessment is found or if MLflow is unavailable.
 */
async function getUserAssessmentForTrace(
  hostUrl: string,
  token: string,
  traceId: string,
  userId: string,
): Promise<{ assessmentId: string; feedbackType: 'thumbs_up' | 'thumbs_down' } | null> {
  const response = await fetch(
    `${hostUrl}/api/3.0/mlflow/traces/${traceId}/assessments`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) return null;
  const data = await response.json();
  const assessment = (data.assessments ?? []).find(
    (a: any) =>
      a.assessment_name === 'user_feedback' && a.source?.source_id === userId,
  );
  if (!assessment) return null;
  return {
    assessmentId: assessment.assessment_id,
    feedbackType: assessment.feedback?.value === true ? 'thumbs_up' : 'thumbs_down',
  };
}

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

    // Get the message to retrieve traceId
    const messages = await getMessageById({ id: messageId });
    let traceId: string | null;

    if (!messages || messages.length === 0) {
      // Fall back to in-memory store (ephemeral mode or DB unavailable)
      const meta = getMessageMeta(messageId);
      if (!meta) {
        const error = new ChatSDKError('not_found:database');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
      traceId = meta.traceId;
    } else {
      const dbMessage = messages[0];
      traceId = dbMessage.traceId;
    }

    let mlflowAssessmentId: string | undefined;

    // Submit to MLflow if we have a trace ID
    if (traceId) {
      try {
        const token = await getDatabricksToken();
        const hostUrl = await getWorkspaceHostname();
        const userId = session.user.email ?? session.user.id;

        // Check for an existing assessment to update (deduplication).
        // Memory-first: check the in-memory assessment store.
        // If not in memory, call MLflow to check for an existing assessment.
        let existingAssessmentId = getAssessmentId(messageId, session.user.id);
        if (!existingAssessmentId) {
          const existing = await getUserAssessmentForTrace(hostUrl, token, traceId, userId);
          existingAssessmentId = existing?.assessmentId ?? null;
        }

        let mlflowResponse: Response;
        if (existingAssessmentId) {
          // PATCH to update the existing assessment
          mlflowResponse = await fetch(
            `${hostUrl}/api/3.0/mlflow/traces/${traceId}/assessments/${existingAssessmentId}`,
            {
              method: 'PATCH',
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
                    source_id: userId,
                  },
                  feedback: {
                    value: feedbackType === 'thumbs_up',
                  },
                },
                update_mask: 'feedback,source',
              }),
            },
          );
        } else {
          // POST to create a new assessment
          mlflowResponse = await fetch(
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
                    source_id: userId,
                  },
                  feedback: {
                    value: feedbackType === 'thumbs_up',
                  },
                },
              }),
            },
          );
        }

        if (!mlflowResponse.ok) {
          const errorText = await mlflowResponse.text();
          console.error('Failed to submit feedback to MLflow:', errorText);
        } else {
          const mlflowResult = await mlflowResponse.json();
          mlflowAssessmentId = mlflowResult.assessment?.assessment_id;
          console.log('Successfully submitted feedback to MLflow:', mlflowAssessmentId);
          // Store assessment ID for deduplication on subsequent submissions
          if (mlflowAssessmentId) {
            storeAssessmentId(messageId, session.user.id, mlflowAssessmentId);
          }
        }
      } catch (error) {
        console.error('Error submitting feedback to MLflow:', error);
        // Continue even if MLflow submission fails
      }
    } else {
      console.warn('Message does not have a trace ID, skipping MLflow submission');
    }

    return res.status(200).json({
      success: true,
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
 * GET /api/feedback/chat/:chatId - Get all feedback for a chat
 *
 * Fetches messages for the chat, then queries MLflow assessments for each
 * message that has a traceId. Returns a map of messageId -> feedback.
 * Returns empty map if MLflow is unavailable (graceful degradation).
 */
feedbackRouter.get(
  '/chat/:chatId',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { chatId } = req.params;
      const session = req.session;
      if (!session) {
        return res.status(200).json({});
      }

      const userId = session.user.email ?? session.user.id;

      // Get all messages for this chat that have trace IDs
      const messages = await getMessagesByChatId({ id: chatId });
      const messagesWithTrace = messages.filter((msg) => msg.traceId != null);

      if (messagesWithTrace.length === 0) {
        return res.status(200).json({});
      }

      try {
        const token = await getDatabricksToken();
        const hostUrl = await getWorkspaceHostname();

        // Fetch assessments for all messages in parallel
        const results = await Promise.allSettled(
          messagesWithTrace.map(async (msg) => {
            const assessment = await getUserAssessmentForTrace(
              hostUrl,
              token,
              msg.traceId!,
              userId,
            );
            return { messageId: msg.id, assessment };
          }),
        );

        // Build messageId -> feedback map
        const feedbackMap: Record<
          string,
          { messageId: string; feedbackType: 'thumbs_up' | 'thumbs_down'; assessmentId: string | null }
        > = {};
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.assessment) {
            const { messageId, assessment } = result.value;
            feedbackMap[messageId] = {
              messageId,
              feedbackType: assessment.feedbackType,
              assessmentId: assessment.assessmentId,
            };
          }
        }

        return res.status(200).json(feedbackMap);
      } catch (error) {
        // If MLflow is unavailable, return empty map (graceful degradation)
        console.warn('[Feedback] MLflow unavailable for chat feedback:', error);
        return res.status(200).json({});
      }
    } catch (error) {
      console.error('[Feedback] Error getting feedback by chat:', error);
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

/**
 * GET /api/feedback/:messageId - Get feedback for a message
 */
feedbackRouter.get(
  '/:messageId',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params;
      const session = req.session;
      if (!session) {
        return res.status(200).json({ feedback: null });
      }

      const userId = session.user.email ?? session.user.id;

      // Get the message to retrieve traceId
      const messages = await getMessageById({ id: messageId });
      let traceId: string | null;

      if (!messages || messages.length === 0) {
        const meta = getMessageMeta(messageId);
        traceId = meta?.traceId ?? null;
      } else {
        traceId = messages[0].traceId;
      }

      if (!traceId) {
        return res.status(200).json({ feedback: null });
      }

      try {
        const token = await getDatabricksToken();
        const hostUrl = await getWorkspaceHostname();
        const assessment = await getUserAssessmentForTrace(hostUrl, token, traceId, userId);

        if (!assessment) {
          return res.status(200).json({ feedback: null });
        }

        return res.status(200).json({
          feedback: {
            messageId,
            feedbackType: assessment.feedbackType,
            assessmentId: assessment.assessmentId,
          },
        });
      } catch (error) {
        console.warn('[Feedback] MLflow unavailable for message feedback:', error);
        return res.status(200).json({ feedback: null });
      }
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
