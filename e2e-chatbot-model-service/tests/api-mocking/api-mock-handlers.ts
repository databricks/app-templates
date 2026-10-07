import { http, HttpResponse } from 'msw';
import {
  createMockStreamResponse,
  createMockImmediateStreamErrorResponse,
  mockFmapiSSE,
  mockFmapiResponseObject,
  mockSSE,
} from '../helpers';
import { TEST_PROMPTS } from '../prompts/routes';

/** Captures headers from the last request to the model service. */
let lastModelServiceRequestHeaders: Record<string, string> = {};

export function getLastModelServiceRequestHeaders(): Record<string, string> {
  return lastModelServiceRequestHeaders;
}

// ============================================================================
// MLflow Assessment State Management
// ============================================================================

interface StoredAssessment {
  assessment_id: string;
  assessment_name: string;
  trace_id: string;
  source: { source_type: string; source_id: string };
  feedback: { value: boolean };
}

/** In-memory store: traceId -> list of assessments. Populated by POST/PATCH handlers. */
const mlflowAssessmentStore: Record<string, StoredAssessment[]> = {};

/**
 * Reset MLflow assessment store. Call this in beforeEach for tests that
 * use fixed trace IDs, to prevent state from bleeding between test runs.
 */
export function resetMlflowAssessmentStore() {
  for (const key of Object.keys(mlflowAssessmentStore)) {
    delete mlflowAssessmentStore[key];
  }
}

// ============================================================================
// Stream Error Trigger Detection
// ============================================================================

const FALLBACK_TEXT = 'Fallback response after stream error';
const MID_STREAM_PARTIAL_TEXT = 'Partial text before';

function messagesContain(body: unknown, phrase: string): boolean {
  const messages = (body as { messages?: unknown[] })?.messages;
  return JSON.stringify(messages ?? '').toLowerCase().includes(phrase);
}

// ============================================================================
// Mock Handlers
// ============================================================================

export const handlers = [
  // Mock chat completions. Matches on the /chat/completions path suffix
  // regardless of host/prefix, so it covers the Unity Gateway model-service
  // path (/ai-gateway/mlflow/v1/chat/completions) used for the main chat
  // model, title model, and artifact model alike, all sending the same
  // OpenAI-compatible request/response shape.
  http.post(/\/chat\/completions$/, async (req) => {
    lastModelServiceRequestHeaders = Object.fromEntries(req.request.headers.entries());
    const body = await req.request.clone().json();
    const isStreaming = (body as { stream?: boolean })?.stream;

    // Stream error before first text chunk → streaming gets broken body, fallback generateText succeeds
    if (messagesContain(body, 'trigger stream error')) {
      if (isStreaming) {
        return createMockImmediateStreamErrorResponse();
      }
      return HttpResponse.json(mockFmapiResponseObject(FALLBACK_TEXT));
    }

    // Mid-stream error → sends some text then the model fails. The openai-compatible
    // provider treats any chunk containing an `error` field as a stream error
    // (see @ai-sdk/openai-compatible's chat chunk schema), so a plain SSE line with
    // that shape is enough to trigger the same fallback path as a real failure.
    if (messagesContain(body, 'trigger mid-stream error') && isStreaming) {
      return createMockStreamResponse([
        mockFmapiSSE('STATIC_ID', {
          role: 'assistant',
          content: MID_STREAM_PARTIAL_TEXT,
        }),
        mockSSE({ error: { message: 'Mock mid-stream error', type: 'server_error' } }),
        'data: [DONE]',
      ]);
    }

    if (isStreaming) {
      return createMockStreamResponse(
        TEST_PROMPTS.SKY.OUTPUT_STREAM.responseSSE,
      );
    } else {
      return HttpResponse.json(TEST_PROMPTS.SKY.OUTPUT_TITLE.response);
    }
  }),

  // Mock fetching SCIM user
  http.get(/\/api\/2\.0\/preview\/scim\/v2\/Me$/, () => {
    return HttpResponse.json({
      id: '123',
      userName: 'test-user',
      displayName: 'Test User',
      emails: [{ value: 'test@example.com', primary: true }],
    });
  }),

  // Mock fetching oidc token
  http.post(/\/oidc\/v1\/token$/, () => {
    return HttpResponse.json({
      access_token: 'test-token',
    });
  }),

  // Mock MLflow GET trace endpoint.
  // Returns a minimal trace object with assessments embedded in trace_info.assessments.
  // The server reads assessments from the trace object rather than a separate assessments
  // endpoint, since the standalone GET .../assessments route is not available in all workspaces.
  // URL: GET /api/3.0/mlflow/traces/{trace_id}
  http.get(/\/api\/3\.0\/mlflow\/traces\/([^/]+)$/, (req) => {
    const url = req.request.url;
    const traceIdMatch = url.match(/\/traces\/([^/]+)$/);
    const traceId = traceIdMatch?.[1] ?? 'unknown';
    const assessments = mlflowAssessmentStore[traceId] ?? [];

    return HttpResponse.json({
      trace: {
        trace_info: {
          trace_id: traceId,
          assessments,
        },
      },
    });
  }),

  // Mock MLflow assessments POST endpoint (api/3.0, trace_id in URL path).
  // Validates the request body has the correct structure:
  //   { assessment: { trace_id, assessment_name, source, feedback: { value: boolean } } }
  // Stores the assessment in mlflowAssessmentStore for GET to return.
  http.post(/\/api\/3\.0\/mlflow\/traces\/([^/]+)\/assessments$/, async (req) => {
    const url = req.request.url;
    const traceIdMatch = url.match(/\/traces\/([^/]+)\/assessments/);
    const traceId = traceIdMatch?.[1] ?? 'unknown';

    const body = (await req.request.json()) as {
      assessment?: {
        trace_id?: string;
        assessment_name?: string;
        source?: { source_type?: string; source_id?: string };
        feedback?: { value?: unknown };
      };
    };

    // Validate required fields — return 400 if malformed so tests catch wrong body format
    const assessment = body?.assessment;
    const feedbackValue = assessment?.feedback?.value;
    if (
      !assessment ||
      assessment.trace_id !== traceId ||
      !assessment.assessment_name ||
      typeof feedbackValue !== 'boolean'
    ) {
      return HttpResponse.json(
        {
          error_code: 'INVALID_PARAMETER_VALUE',
          message: `Mock: invalid assessment body. Got feedback.value=${JSON.stringify(feedbackValue)} (expected boolean)`,
        },
        { status: 400 },
      );
    }

    const assessmentId = `mock-assessment-${traceId}`;
    const stored: StoredAssessment = {
      assessment_id: assessmentId,
      assessment_name: assessment.assessment_name,
      trace_id: traceId,
      source: {
        source_type: assessment.source?.source_type ?? 'HUMAN',
        source_id: assessment.source?.source_id ?? '',
      },
      feedback: { value: feedbackValue },
    };

    // Store (replace any existing assessment for this trace+source)
    const existing = mlflowAssessmentStore[traceId] ?? [];
    const idx = existing.findIndex(
      (a) => a.source.source_id === stored.source.source_id,
    );
    if (idx >= 0) {
      existing[idx] = stored;
    } else {
      existing.push(stored);
    }
    mlflowAssessmentStore[traceId] = existing;

    return HttpResponse.json({
      assessment: {
        assessment_id: assessmentId,
        trace_id: traceId,
        assessment_name: assessment.assessment_name,
      },
    });
  }),

  // Mock MLflow assessments PATCH endpoint (update existing assessment).
  // URL: PATCH /api/3.0/mlflow/traces/{trace_id}/assessments/{assessment_id}
  // Updates the stored assessment's feedback value.
  http.patch(
    /\/api\/3\.0\/mlflow\/traces\/([^/]+)\/assessments\/([^/]+)$/,
    async (req) => {
      const url = req.request.url;
      const match = url.match(/\/traces\/([^/]+)\/assessments\/([^/]+)/);
      const traceId = match?.[1] ?? 'unknown';
      const assessmentId = match?.[2] ?? 'unknown';

      const body = (await req.request.json()) as {
        assessment?: {
          trace_id?: string;
          assessment_name?: string;
          source?: { source_type?: string; source_id?: string };
          feedback?: { value?: unknown };
        };
      };

      const assessment = body?.assessment;
      const feedbackValue = assessment?.feedback?.value;
      if (
        !assessment ||
        assessment.trace_id !== traceId ||
        !assessment.assessment_name ||
        typeof feedbackValue !== 'boolean'
      ) {
        return HttpResponse.json(
          {
            error_code: 'INVALID_PARAMETER_VALUE',
            message: `Mock: invalid PATCH assessment body. Got feedback.value=${JSON.stringify(feedbackValue)} (expected boolean)`,
          },
          { status: 400 },
        );
      }

      // Reject source updates — matches real MLflow behavior
      if ((assessment as { source?: unknown }).source !== undefined) {
        return HttpResponse.json(
          {
            error_code: 'INVALID_PARAMETER_VALUE',
            message: "The field `source` may not be updated.",
          },
          { status: 400 },
        );
      }

      // Update the stored assessment's feedback value
      const existing = mlflowAssessmentStore[traceId] ?? [];
      const idx = existing.findIndex((a) => a.assessment_id === assessmentId);
      if (idx >= 0) {
        existing[idx] = {
          ...existing[idx],
          feedback: { value: feedbackValue },
          source: {
            source_type: assessment.source?.source_type ?? existing[idx].source.source_type,
            source_id: assessment.source?.source_id ?? existing[idx].source.source_id,
          },
        };
        mlflowAssessmentStore[traceId] = existing;
      }

      return HttpResponse.json({
        assessment: {
          assessment_id: assessmentId,
          trace_id: traceId,
          assessment_name: assessment.assessment_name,
        },
      });
    },
  ),
];
