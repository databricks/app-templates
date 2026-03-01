import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth';
import {
  getMessageById,
  voteMessage,
  getVotesByChatId,
} from '@chat-template/db';
import { checkChatAccess } from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';
import { getDatabricksToken } from '@chat-template/auth';
import { getWorkspaceHostname } from '@chat-template/ai-sdk-providers';
import {
  getMessageMetadata,
  getAssessmentId,
  storeAssessmentId,
} from '../lib/message-meta-store';

export const feedbackRouter: RouterType = Router();

feedbackRouter.use(authMiddleware);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    // Get the message to retrieve traceId and chatId
    const messages = await getMessageById({ id: messageId });
    let traceId: string | null;
    let chatId: string | undefined;

    if (!messages || messages.length === 0) {
      // Fall back to in-memory store (ephemeral mode or DB unavailable)
      const metadata = getMessageMetadata(messageId);
      if (!metadata) {
        const error = new ChatSDKError('not_found:database');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
      traceId = metadata.traceId;
      chatId = metadata.chatId;
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
        const userId = session.user.email ?? session.user.id;

        // Check for an existing assessment to update (deduplication).
        // Memory-first: check the in-memory assessment store.
        const existingAssessmentId = getAssessmentId(messageId, session.user.id);

        let mlflowResponse: globalThis.Response;
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
                  feedback: {
                    value: feedbackType === 'thumbs_up',
                  },
                },
                update_mask: 'feedback',
              }),
            },
          );
        } else {
          // POST to create a new assessment, retrying on 404.
          // The trace may not be indexed in MLflow immediately after the stream
          // completes (eventual consistency), so we retry up to 3 times.
          const MAX_RETRIES = 3;
          const RETRY_DELAY_MS = 1000;
          const postBody = JSON.stringify({
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
          });
          const postHeaders = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          };
          const mlflowUrl = `${hostUrl}/api/3.0/mlflow/traces/${traceId}/assessments`;
          mlflowResponse = await fetch(mlflowUrl, {
            method: 'POST',
            headers: postHeaders,
            body: postBody,
          });
          for (
            let attempt = 1;
            attempt < MAX_RETRIES &&
            !mlflowResponse.ok &&
            mlflowResponse.status === 404;
            attempt++
          ) {
            console.warn(
              `[Feedback] MLflow trace not found (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms`,
            );
            await sleep(RETRY_DELAY_MS);
            mlflowResponse = await fetch(mlflowUrl, {
              method: 'POST',
              headers: postHeaders,
              body: postBody,
            });
          }
        }

        if (!mlflowResponse.ok) {
          const errorText = await mlflowResponse.text();
          console.error('Failed to submit feedback to MLflow:', errorText);
          return res
            .status(mlflowResponse.status)
            .json({ error: 'Failed to submit feedback' });
        }

        const mlflowResult = await mlflowResponse.json();
        mlflowAssessmentId = mlflowResult.assessment?.assessment_id;
        // Store assessment ID for deduplication on subsequent submissions
        if (mlflowAssessmentId) {
          storeAssessmentId(messageId, session.user.id, mlflowAssessmentId);
        }
      } catch (error) {
        console.error('Error submitting feedback to MLflow:', error);
        const chatError = new ChatSDKError('offline:chat');
        const chatResponse = chatError.toResponse();
        return res.status(chatResponse.status).json(chatResponse.json);
      }
    } else {
      console.warn(
        'Message does not have a trace ID, skipping MLflow submission',
      );
    }

    // Also persist to DB for fast bulk reads on page load
    if (chatId) {
      voteMessage({
        chatId,
        messageId,
        type: feedbackType === 'thumbs_up' ? 'up' : 'down',
      }).catch((err) =>
        console.warn('[Feedback] DB vote save failed:', err),
      );
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
 * Reads votes from the DB for fast single-query page load.
 * Returns a map of messageId -> feedback.
 * Returns empty map if DB is unavailable (graceful degradation).
 */
feedbackRouter.get(
  '/chat/:chatId',
  requireAuth,
  async (req: Request, res: Response) => {
    // Prevent browser caching so stale {} responses don't block fresh feedback data
    res.set('Cache-Control', 'no-store');
    try {
      const { chatId } = req.params;
      const session = req.session;
      if (!session) {
        return res.status(200).json({});
      }

      // Ownership check: verify the chat belongs to the requesting user
      const { allowed, reason } = await checkChatAccess(
        chatId as string,
        session.user.id,
      );
      if (reason !== 'not_found' && !allowed) {
        return res.status(200).json({});
      }

      const dbVotes = await getVotesByChatId({ id: chatId as string });
      type Feedback = {
        messageId: string;
        feedbackType: 'thumbs_up' | 'thumbs_down';
        assessmentId: null;
      };
      const feedbackMap: Record<string, Feedback> = {};
      for (const v of dbVotes) {
        feedbackMap[v.messageId] = {
          messageId: v.messageId,
          feedbackType: v.isUpvoted ? 'thumbs_up' : 'thumbs_down',
          assessmentId: null,
        };
      }

      return res.status(200).json(feedbackMap);
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
