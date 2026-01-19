/**
 * MLflow Client for submitting feedback assessments
 *
 * This client provides integration with the MLflow Assessments API
 * to log user feedback (thumbs up/down) as trace assessments.
 */

interface MLflowConfig {
  host: string;
  token: string;
  experimentId?: string;
}

interface FeedbackSubmission {
  messageId: string;
  chatId: string;
  userId: string;
  feedbackType: 'thumbs_up' | 'thumbs_down';
  assessmentId?: string;
}

/**
 * Get MLflow configuration from environment variables
 */
function getMLflowConfig(): MLflowConfig | null {
  const host = process.env.DATABRICKS_HOST;
  const token =
    process.env.DATABRICKS_TOKEN ||
    process.env.DATABRICKS_CLIENT_SECRET ||
    process.env.DATABRICKS_ACCESS_TOKEN;
  const experimentId = process.env.MLFLOW_EXPERIMENT_ID;

  if (!host || !token) {
    console.log(
      '[MLflow] Missing required configuration (DATABRICKS_HOST or token)',
    );
    return null;
  }

  return {
    host,
    token,
    experimentId,
  };
}

/**
 * Create a new assessment in MLflow
 */
async function createAssessment(
  config: MLflowConfig,
  submission: FeedbackSubmission,
): Promise<string | null> {
  try {
    const url = `${config.host}/api/2.0/mlflow/traces/assessments`;

    const payload = {
      name: 'user_feedback',
      source: 'chatbot_ui',
      experiment_id: config.experimentId,
      trace_id: submission.messageId, // Using messageId as trace_id
      metadata: {
        chat_id: submission.chatId,
        user_id: submission.userId,
      },
      value: submission.feedbackType === 'thumbs_up' ? 1 : 0,
      value_type: 'numeric',
      tags: {
        feedback_type: submission.feedbackType,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[MLflow] Failed to create assessment: ${response.status} - ${errorText}`,
      );
      return null;
    }

    const result = await response.json();
    return result.assessment_id || null;
  } catch (error) {
    console.error('[MLflow] Error creating assessment:', error);
    return null;
  }
}

/**
 * Update an existing assessment in MLflow
 */
async function updateAssessment(
  config: MLflowConfig,
  submission: FeedbackSubmission,
): Promise<boolean> {
  if (!submission.assessmentId) {
    console.error('[MLflow] No assessment ID provided for update');
    return false;
  }

  try {
    const url = `${config.host}/api/2.0/mlflow/traces/assessments/${submission.assessmentId}`;

    const payload = {
      value: submission.feedbackType === 'thumbs_up' ? 1 : 0,
      tags: {
        feedback_type: submission.feedbackType,
      },
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[MLflow] Failed to update assessment: ${response.status} - ${errorText}`,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('[MLflow] Error updating assessment:', error);
    return false;
  }
}

/**
 * Submit feedback to MLflow (side effect, fire and forget)
 *
 * This function attempts to create or update an assessment in MLflow.
 * It's designed to be called asynchronously without blocking the main request.
 */
export async function submitToMLflow(
  submission: FeedbackSubmission,
): Promise<void> {
  const config = getMLflowConfig();

  if (!config) {
    console.log('[MLflow] Skipping submission - MLflow not configured');
    return;
  }

  console.log(
    `[MLflow] Submitting feedback for message ${submission.messageId}`,
  );

  try {
    if (submission.assessmentId) {
      // Update existing assessment
      const success = await updateAssessment(config, submission);
      if (success) {
        console.log(
          `[MLflow] Successfully updated assessment ${submission.assessmentId}`,
        );
      }
    } else {
      // Create new assessment
      const assessmentId = await createAssessment(config, submission);
      if (assessmentId) {
        console.log(`[MLflow] Successfully created assessment ${assessmentId}`);
        // TODO: Update the feedback record in the database with the new assessmentId
      }
    }
  } catch (error) {
    console.error('[MLflow] Error submitting to MLflow:', error);
  }
}
