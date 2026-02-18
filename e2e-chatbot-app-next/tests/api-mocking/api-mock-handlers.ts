import { http, HttpResponse } from 'msw';
import {
  createMockStreamResponse,
  mockMcpApprovalRequestStream,
  mockMcpApprovalApprovedStream,
  mockMcpApprovalDeniedStream,
  mockResponsesApiMultiDeltaTextStream,
} from '../helpers';
import { TEST_PROMPTS } from '../prompts/routes';

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
 * Check if the request contains an MCP approval response (tool result).
 */
function containsMcpApprovalResponse(body: unknown): {
  found: boolean;
  approved: boolean;
} {
  const input = (body as { input?: unknown[] })?.input;
  if (!Array.isArray(input)) return { found: false, approved: false };

  for (const item of input) {
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as { type?: string }).type === 'mcp_approval_response'
    ) {
      const approved = (item as { approve?: boolean }).approve === true;
      return { found: true, approved };
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
    if ((body as { stream?: boolean })?.stream) {
      return createMockStreamResponse(
        TEST_PROMPTS.SKY.OUTPUT_STREAM.responseSSE,
      );
    } else {
      return HttpResponse.json(TEST_PROMPTS.SKY.OUTPUT_TITLE.response);
    }
  }),

  // Mock responses endpoint (agent/v2/responses)
  // URL pattern: {host}/serving-endpoints/responses
  http.post(/\/serving-endpoints\/responses$/, async (req) => {
    const body = await req.request.clone().json();
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
  // Returns agent/v2/responses to enable MCP approval testing
  http.get(/\/api\/2\.0\/serving-endpoints\/[^/]+$/, () => {
    return HttpResponse.json({
      name: 'test-endpoint',
      task: 'agent/v2/responses',
    });
  }),

  // Mock fetching oidc token
  http.post(/\/oidc\/v1\/token$/, () => {
    return HttpResponse.json({
      access_token: 'test-token',
    });
  }),

  // Mock MLflow assessments endpoint (api/3.0, trace_id in URL path).
  // Validates the request body has the correct structure:
  //   { assessment: { trace_id, assessment_name, source, feedback: { value: boolean } } }
  http.post(/\/api\/3\.0\/mlflow\/traces\/([^/]+)\/assessments$/, async (req) => {
    const url = req.request.url;
    const traceIdMatch = url.match(/\/traces\/([^/]+)\/assessments/);
    const traceId = traceIdMatch?.[1] ?? 'unknown';

    const body = (await req.request.json()) as {
      assessment?: {
        trace_id?: string;
        assessment_name?: string;
        source?: { source_type?: string };
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

    return HttpResponse.json({
      assessment: {
        assessment_id: `mock-assessment-${traceId}`,
        trace_id: traceId,
        assessment_name: assessment.assessment_name,
      },
    });
  }),
];
