import { http, HttpResponse } from 'msw';
import {
  createMockStreamResponse,
  mockMcpApprovalRequestStream,
  mockMcpApprovalApprovedStream,
  mockMcpApprovalDeniedStream,
  mockMlflowAgentServerStream,
  mockResponsesApiMultiDeltaTextStream,
} from '../helpers';
import { TEST_PROMPTS } from '../prompts/routes';

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

// ============================================================================
// MCP Approval State Management
// ============================================================================

/**
 * State machine for MCP approval flow.
 * This tracks the state of approval requests across multiple API calls.
 */
type McpApprovalState = 'idle' | 'awaiting-approval' | 'approved' | 'denied';

let mcpApprovalState: McpApprovalState = 'idle';
const MCP_REQUEST_ID = '__fake_mcp_request_id__';

/**
 * Reset MCP approval state. Call this in test beforeEach.
 */
export function resetMcpApprovalState() {
  mcpApprovalState = 'idle';
}

// ============================================================================
// Context Injection Tracking
// ============================================================================

/**
 * Captured request contexts for testing context injection.
 * Each entry contains the context object if present, or undefined if not.
 */
export interface CapturedRequest {
  url: string;
  timestamp: number;
  context?: {
    conversation_id?: string;
    user_id?: string;
    [key: string]: unknown;
  };
  hasContext: boolean;
}

let capturedRequests: CapturedRequest[] = [];

/**
 * Reset captured requests. Call this before tests that need to verify context injection.
 */
export function resetCapturedRequests() {
  capturedRequests = [];
}

/**
 * Get all captured requests.
 */
export function getCapturedRequests(): CapturedRequest[] {
  return [...capturedRequests];
}

/**
 * Get the most recent captured request.
 */
export function getLastCapturedRequest(): CapturedRequest | undefined {
  return capturedRequests[capturedRequests.length - 1];
}

/**
 * Helper to capture request context from a request body.
 */
function captureRequestContext(url: string, body: unknown): void {
  const context = (body as { context?: CapturedRequest['context'] })?.context;
  capturedRequests.push({
    url,
    timestamp: Date.now(),
    context,
    hasContext: context !== undefined && context !== null,
  });
}

/**
 * Check if the request body contains MCP approval trigger message.
 */
function isMcpTriggerMessage(body: unknown): boolean {
  const input = (body as { input?: unknown[] })?.input;
  if (!Array.isArray(input)) return false;

  return input.some((item) => {
    if (typeof item === 'object' && item !== null) {
      // Check for text content that triggers MCP
      const content = (item as { content?: unknown }).content;
      if (typeof content === 'string') {
        return content.toLowerCase().includes('trigger mcp');
      }
      // Check for array of content parts
      if (Array.isArray(content)) {
        return content.some(
          (part) =>
            typeof part === 'object' &&
            part !== null &&
            (part as { type?: string; text?: string }).type === 'input_text' &&
            (part as { text?: string }).text
              ?.toLowerCase()
              .includes('trigger mcp'),
        );
      }
    }
    return false;
  });
}

/**
 * Check if the request contains an MCP approval response.
 *
 * This can come in two forms:
 * 1. Explicit mcp_approval_response type (from server-side conversion)
 * 2. function_call_output with __approvalStatus__ in the output (from client-side addToolOutput)
 */
function containsMcpApprovalResponse(body: unknown): {
  found: boolean;
  approved: boolean;
} {
  const input = (body as { input?: unknown[] })?.input;
  if (!Array.isArray(input)) return { found: false, approved: false };

  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue;

    const itemType = (item as { type?: string }).type;

    // Check for explicit mcp_approval_response type
    if (itemType === 'mcp_approval_response') {
      const approved = (item as { approve?: boolean }).approve === true;
      return { found: true, approved };
    }

    // Check for function_call_output with approval status in the output
    // This handles the case where the approval comes via addToolOutput from the client
    if (itemType === 'function_call_output') {
      const output = (item as { output?: string }).output;
      if (typeof output === 'string') {
        try {
          const parsed = JSON.parse(output);
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            '__approvalStatus__' in parsed
          ) {
            const approved = parsed.__approvalStatus__ === true;
            return { found: true, approved };
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }
  }

  return { found: false, approved: false };
}

// ============================================================================
// Mock Handlers
// ============================================================================

export const handlers = [
  // Mock chat completions (FMAPI - llm/v1/chat)
  // Use RegExp for better URL matching - matches any URL containing /serving-endpoints/ and ending with /chat/completions
  http.post(/\/serving-endpoints\/[^/]+\/chat\/completions$/, async (req) => {
    const body = await req.request.clone().json();
    captureRequestContext(req.request.url, body);
    if ((body as { stream?: boolean })?.stream) {
      return createMockStreamResponse(
        TEST_PROMPTS.SKY.OUTPUT_STREAM.responseSSE,
      );
    } else {
      return HttpResponse.json(TEST_PROMPTS.SKY.OUTPUT_TITLE.response);
    }
  }),

  // Mock responses endpoint (agent/v1/responses)
  // URL pattern: {host}/serving-endpoints/responses
  http.post(/\/serving-endpoints\/responses$/, async (req) => {
    const body = await req.request.clone().json();
    captureRequestContext(req.request.url, body);
    const isStreaming = (body as { stream?: boolean })?.stream;
    // Detect if the request wants trace data (injected by databricksFetch)
    const returnTrace =
      (body as any)?.databricks_options?.return_trace === true;
    const streamTraceId = returnTrace ? 'mock-trace-id-from-databricks' : undefined;

    // Check for MCP approval response in the request
    const { found: hasApprovalResponse, approved } =
      containsMcpApprovalResponse(body);

    if (hasApprovalResponse && mcpApprovalState === 'awaiting-approval') {
      // User responded to approval request
      mcpApprovalState = approved ? 'approved' : 'denied';

      if (isStreaming) {
        const stream = approved
          ? mockMcpApprovalApprovedStream({ requestId: MCP_REQUEST_ID })
          : mockMcpApprovalDeniedStream({ requestId: MCP_REQUEST_ID });
        return createMockStreamResponse(stream);
      }
    }

    // Check if this is a trigger for MCP approval
    if (isMcpTriggerMessage(body)) {
      mcpApprovalState = 'awaiting-approval';

      if (isStreaming) {
        return createMockStreamResponse(
          mockMcpApprovalRequestStream({ requestId: MCP_REQUEST_ID }),
        );
      }
    }

    // Default response: split text into per-word chunks to replicate real streaming
    // (one response.output_text.delta per token). This is necessary to reproduce
    // the delta-boundary bug where interleaved raw+text-delta chunks break streaming.
    // Pass streamTraceId so the response.output_item.done event includes trace data
    // when the request contained databricks_options.return_trace === true.
    if (isStreaming) {
      return createMockStreamResponse(
        mockResponsesApiMultiDeltaTextStream(
          ["It's", ' just', ' blue', ' duh!'],
          streamTraceId,
        ),
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

  // Mock fetching endpoint details
  // Returns agent/v1/responses to enable context injection testing
  http.get(/\/api\/2\.0\/serving-endpoints\/[^/]+$/, () => {
    return HttpResponse.json({
      name: 'test-endpoint',
      task: 'agent/v1/responses',
    });
  }),

  // Mock fetching oidc token
  http.post(/\/oidc\/v1\/token$/, () => {
    return HttpResponse.json({
      access_token: 'test-token',
    });
  }),

  // Mock MLflow AgentServer invocations endpoint (API_PROXY mode).
  // Checks for x-mlflow-return-trace-id header and appends standalone trace-ID event.
  http.post(/mlflow-agent-server-mock\/invocations$/, async (req) => {
    const returnTrace =
      req.request.headers.get('x-mlflow-return-trace-id')?.toLowerCase() ===
      'true';
    return createMockStreamResponse(
      mockMlflowAgentServerStream(
        ["It's", ' just', ' blue', ' duh!'],
        returnTrace,
      ),
    );
  }),

  // Mock MLflow GET assessments endpoint.
  // Returns stored assessments for the given trace ID.
  // URL: GET /api/3.0/mlflow/traces/{trace_id}/assessments
  http.get(/\/api\/3\.0\/mlflow\/traces\/([^/]+)\/assessments$/, (req) => {
    const url = req.request.url;
    const traceIdMatch = url.match(/\/traces\/([^/]+)\/assessments/);
    const traceId = traceIdMatch?.[1] ?? 'unknown';

    return HttpResponse.json({
      assessments: mlflowAssessmentStore[traceId] ?? [],
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
