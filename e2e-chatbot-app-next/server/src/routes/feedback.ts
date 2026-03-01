import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import { authMiddleware, requireAuth } from '../middleware/auth';
import { getMessageById, getMessagesByChatId } from '@chat-template/db';
import { checkChatAccess } from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';
import { getDatabricksToken } from '@chat-template/auth';
import { getWorkspaceHostname } from '@chat-template/ai-sdk-providers';
import {
  getMessageMetadata,
  getMessageMetasByChatId,
  getAssessmentId,
  storeAssessmentId,
} from '../lib/message-meta-store';

export const feedbackRouter: RouterType = Router();

feedbackRouter.use(authMiddleware);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the user's assessment for a specific trace from MLflow.
 * Reads assessments from the trace object itself (GET /mlflow/traces/:traceId),
 * since the standalone assessments list endpoint is not available in all workspaces.
 * Returns null if no matching assessment is found or if MLflow is unavailable.
 */
async function getUserAssessmentForTrace(
  hostUrl: string,
  token: string,
  traceId: string,
  userId: string,
): Promise<{ assessmentId: string; feedbackType: 'thumbs_up' | 'thumbs_down' } | null> {
  const response = await fetch(
    `${hostUrl}/api/3.0/mlflow/traces/${traceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    console.warn(`[Feedback] MLflow trace status=${response.status} for traceId=${traceId}`);
    return null;
  }
  const data = await response.json();
  const allAssessments = data.trace?.trace_info?.assessments ?? [];
  const assessment = allAssessments.find(
    (a: any) =>
      a.assessment_name === 'user_feedback' && a.source?.source_id === userId,
  );
  if (!assessment) {
    if (allAssessments.length > 0) {
      // Log the actual source_id from MLflow to help diagnose source_id mismatches
      const sourceIds = allAssessments
        .filter((a: any) => a.assessment_name === 'user_feedback')
        .map((a: any) => a.source?.source_id);
      console.warn(
        `[Feedback] No matching assessment for userId="${userId}". MLflow source_ids: ${JSON.stringify(sourceIds)}`,
      );
    }
    return null;
  }
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
      const metadata = getMessageMetadata(messageId);
      if (!metadata) {
        const error = new ChatSDKError('not_found:database');
        const response = error.toResponse();
        return res.status(response.status).json(response.json);
      }
      traceId = metadata.traceId;
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
          for (let attempt = 1; attempt < MAX_RETRIES && !mlflowResponse.ok && mlflowResponse.status === 404; attempt++) {
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
          return res.status(mlflowResponse.status).json({ error: 'Failed to submit feedback' });
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
    // Prevent browser caching so stale {} responses don't block fresh feedback data
    res.set('Cache-Control', 'no-store');
    try {
      const { chatId } = req.params;
      const session = req.session;
      if (!session) {
        return res.status(200).json({});
      }

      // Ownership check: verify the chat belongs to the requesting user
      const { allowed, reason } = await checkChatAccess(chatId as string, session.user.id);
      if (reason !== 'not_found' && !allowed) {
        return res.status(200).json({});
      }

      const userId = session.user.email ?? session.user.id;

      // Get all messages for this chat that have trace IDs.
      // Fall back to the in-memory store when the DB has no traced messages
      // (ephemeral mode, or the stream finished so recently the DB write is pending).
      const messages = await getMessagesByChatId({ id: chatId as string });
      const dbMessagesWithTrace = messages.filter(
        (msg): msg is typeof msg & { traceId: string } => msg.traceId != null,
      );

      type TracedMessage = { messageId: string; traceId: string };
      let tracedMessages: TracedMessage[];
      if (dbMessagesWithTrace.length > 0) {
        tracedMessages = dbMessagesWithTrace.map((m) => ({
          messageId: m.id,
          traceId: m.traceId,
        }));
      } else {
        // In ephemeral mode the DB is empty; use in-memory store as fallback
        tracedMessages = getMessageMetasByChatId(chatId as string);
      }

      if (tracedMessages.length === 0) {
        return res.status(200).json({});
      }

      try {
        const token = await getDatabricksToken();
        const hostUrl = await getWorkspaceHostname();

        // Fetch assessments for all messages in parallel
        const results = await Promise.allSettled(
          tracedMessages.map(async (msg) => {
            const assessment = await getUserAssessmentForTrace(
              hostUrl,
              token,
              msg.traceId,
              userId,
            );
            return { messageId: msg.messageId, assessment };
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

