import { http, HttpResponse } from 'msw';
import {
  createMockStreamResponse,
  mockMcpApprovalRequestStream,
  mockMcpApprovalApprovedStream,
  mockMcpApprovalDeniedStream,
  mockResponsesApiTextStream,
} from '../helpers';
import { TEST_PROMPTS } from '../prompts/routes';

// ============================================================================
// MCP Approval State Management
// ============================================================================

/**
 * State machine for MCP approval flow.
 * This tracks the state of approval requests across multiple API calls.
 */
type McpApprovalState =
  | 'idle'
  | 'awaiting-approval'
  | 'approved'
  | 'denied';

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

    // Default response for non-MCP requests
    if (isStreaming) {
      return createMockStreamResponse(
        mockResponsesApiTextStream("It's just blue duh!"),
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
];
