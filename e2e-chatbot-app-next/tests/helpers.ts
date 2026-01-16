import { generateUUID } from '@chat-template/core';
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
  TestType,
} from '@playwright/test';

export type UserContext = {
  context: BrowserContext;
  page: Page;
  request: APIRequestContext;
  name: string;
};

export async function createAuthenticatedContext({
  browser,
  name,
}: {
  browser: Browser;
  name: string;
}): Promise<UserContext> {
  const headers = {
    'X-Forwarded-User': `${name}-id`,
    'X-Forwarded-Email': `${name}@example.com`,
    'X-Forwarded-Preferred-Username': name,
  };

  const context = await browser.newContext({ extraHTTPHeaders: headers });
  const page = await context.newPage();

  return {
    context,
    page,
    request: context.request,
    name,
  };
}

export function generateRandomTestUser() {
  const email = `${Date.now()}@example.com`;
  const password = 'password';

  return { email, password };
}

export const createMockStreamResponse = (SSEs: string[]) => {
  return new Response(stringsToStream(SSEs), {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  });
};

export const stringsToStream = (SSEs: string[]) => {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      for (const s of SSEs) {
        controller.enqueue(encoder.encode(`${s}\n\n`));
        // Add delay between chunks to simulate a delay
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      controller.close();
    },
  });
};

/**
 * Create a single SSE line from a JSON-serializable payload.
 *
 * Usage:
 *   const sse = mockSSE<FmapiChunk>(payload)
 *   // → "data: { ... }"
 */
export function mockSSE<T>(payload: T): string {
  return `data: ${JSON.stringify(payload)}`;
}

/**
 * Mock a Fmapi chunk SSE response
 */
export function mockFmapiSSE(
  id: string,
  delta: {
    content?: string;
    role?: string;
    tool_calls?: {
      id: string;
      function: { name: string; arguments: string };
    }[];
  },
): string {
  return mockSSE({
    id,
    created: Date.now(),
    model: 'chat-model',
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta,
      },
    ],
  });
}

/**
 * Mock a Fmapi response object
 */
export function mockFmapiResponseObject(content: string) {
  return {
    id: generateUUID(),
    created: Date.now(),
    model: 'chat-model',
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    choices: [{ message: { role: 'assistant', content } }],
  };
}

// ============================================================================
// Responses API Mock Helpers
// ============================================================================

/**
 * Generate a default mock Responses API stream for a text response.
 * This is used when no special handling (like MCP approval) is needed.
 */
export function mockResponsesApiTextStream(text: string): string[] {
  const responseId = generateUUID();
  const textItemId = generateUUID();

  return [
    // Response created
    mockSSE({
      response: {
        id: responseId,
        created_at: Date.now() / 1000,
        error: null,
        model: 'databricks-claude-3-7-sonnet',
        object: 'response',
        output: [],
      },
      sequence_number: 0,
      type: 'response.created',
    }),
    // Message item added
    mockSSE({
      item: {
        id: textItemId,
        content: [],
        role: 'assistant',
        status: 'in_progress',
        type: 'message',
      },
      output_index: 0,
      sequence_number: 1,
      type: 'response.output_item.added',
    }),
    // Content part added
    mockSSE({
      content_index: 0,
      item_id: textItemId,
      output_index: 0,
      part: { annotations: [], text: '', type: 'output_text', logprobs: null },
      sequence_number: 2,
      type: 'response.content_part.added',
    }),
    // Text delta
    mockSSE({
      content_index: 0,
      delta: text,
      item_id: textItemId,
      logprobs: [],
      output_index: 0,
      sequence_number: 3,
      type: 'response.output_text.delta',
    }),
    // Content part done
    mockSSE({
      content_index: 0,
      item_id: textItemId,
      output_index: 0,
      part: {
        annotations: [],
        text: text,
        type: 'output_text',
        logprobs: null,
      },
      sequence_number: 4,
      type: 'response.content_part.done',
    }),
    // Message item done
    mockSSE({
      item: {
        id: textItemId,
        content: [
          {
            annotations: [],
            text: text,
            type: 'output_text',
            logprobs: null,
          },
        ],
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
      output_index: 0,
      sequence_number: 5,
      type: 'response.output_item.done',
    }),
    // Response completed
    mockSSE({
      response: {
        id: responseId,
        created_at: Date.now() / 1000,
        error: null,
        model: 'databricks-claude-3-7-sonnet',
        object: 'response',
        output: [
          {
            id: textItemId,
            content: [
              {
                annotations: [],
                text: text,
                type: 'output_text',
                logprobs: null,
              },
            ],
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: text.length,
          total_tokens: 100 + text.length,
        },
      },
      sequence_number: 6,
      type: 'response.completed',
    }),
  ];
}

/**
 * Generate a mock Responses API stream for an MCP approval request.
 *
 * This simulates a response where the model wants to use an MCP tool
 * and needs user approval before execution.
 */
export function mockMcpApprovalRequestStream(options?: {
  textBefore?: string;
  toolName?: string;
  serverLabel?: string;
  arguments?: Record<string, unknown>;
  requestId?: string;
}): string[] {
  const {
    textBefore = "I'll help you with that.",
    toolName = 'test_mcp_tool',
    serverLabel = 'test-server',
    arguments: toolArgs = { action: 'test', param: 'value' },
    requestId = '__fake_mcp_request_id__',
  } = options ?? {};

  const responseId = generateUUID();
  const textItemId = generateUUID();

  return [
    // Response created
    mockSSE({
      response: {
        id: responseId,
        created_at: Date.now() / 1000,
        error: null,
        model: 'databricks-claude-3-7-sonnet',
        object: 'response',
        output: [],
      },
      sequence_number: 0,
      type: 'response.created',
    }),
    // Message item added
    mockSSE({
      item: {
        id: textItemId,
        content: [],
        role: 'assistant',
        status: 'in_progress',
        type: 'message',
      },
      output_index: 0,
      sequence_number: 1,
      type: 'response.output_item.added',
    }),
    // Content part added
    mockSSE({
      content_index: 0,
      item_id: textItemId,
      output_index: 0,
      part: { annotations: [], text: '', type: 'output_text', logprobs: null },
      sequence_number: 2,
      type: 'response.content_part.added',
    }),
    // Text delta
    mockSSE({
      content_index: 0,
      delta: textBefore,
      item_id: textItemId,
      logprobs: [],
      output_index: 0,
      sequence_number: 3,
      type: 'response.output_text.delta',
    }),
    // Content part done
    mockSSE({
      content_index: 0,
      item_id: textItemId,
      output_index: 0,
      part: {
        annotations: [],
        text: textBefore,
        type: 'output_text',
        logprobs: null,
      },
      sequence_number: 4,
      type: 'response.content_part.done',
    }),
    // MCP approval request
    mockSSE({
      item: {
        type: 'mcp_approval_request',
        id: requestId,
        name: toolName,
        arguments: JSON.stringify(toolArgs),
        server_label: serverLabel,
      },
      output_index: 1,
      sequence_number: 5,
      type: 'response.output_item.done',
    }),
    // Message item done
    mockSSE({
      item: {
        id: textItemId,
        content: [
          {
            annotations: [],
            text: textBefore,
            type: 'output_text',
            logprobs: null,
          },
        ],
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
      output_index: 0,
      sequence_number: 6,
      type: 'response.output_item.done',
    }),
    // Response completed
    mockSSE({
      response: {
        id: responseId,
        created_at: Date.now() / 1000,
        error: null,
        model: 'databricks-claude-3-7-sonnet',
        object: 'response',
        output: [
          {
            id: textItemId,
            content: [
              {
                annotations: [],
                text: textBefore,
                type: 'output_text',
                logprobs: null,
              },
            ],
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
          {
            type: 'mcp_approval_request',
            id: requestId,
            name: toolName,
            arguments: JSON.stringify(toolArgs),
            server_label: serverLabel,
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
        },
      },
      sequence_number: 7,
      type: 'response.completed',
    }),
  ];
}

/**
 * Generate a mock Responses API stream for an MCP approval response (approved).
 */
export function mockMcpApprovalApprovedStream(options?: {
  requestId?: string;
  continuationText?: string;
}): string[] {
  const {
    requestId = '__fake_mcp_request_id__',
    continuationText = 'The tool has been executed successfully.',
  } = options ?? {};

  const responseId = generateUUID();
  const approvalResponseId = generateUUID();
  const textItemId = generateUUID();

  return [
    // Response created
    mockSSE({
      response: {
        id: responseId,
        created_at: Date.now() / 1000,
        error: null,
        model: 'databricks-claude-3-7-sonnet',
        object: 'response',
        output: [],
      },
      sequence_number: 0,
      type: 'response.created',
    }),
    // MCP approval response
    mockSSE({
      item: {
        type: 'mcp_approval_response',
        id: approvalResponseId,
        approval_request_id: requestId,
        approve: true,
        reason: null,
      },
      output_index: 0,
      sequence_number: 1,
      type: 'response.output_item.done',
    }),
    // Message item added
    mockSSE({
      item: {
        id: textItemId,
        content: [],
        role: 'assistant',
        status: 'in_progress',
        type: 'message',
      },
      output_index: 1,
      sequence_number: 2,
      type: 'response.output_item.added',
    }),
    // Text delta
    mockSSE({
      content_index: 0,
      delta: continuationText,
      item_id: textItemId,
      logprobs: [],
      output_index: 1,
      sequence_number: 3,
      type: 'response.output_text.delta',
    }),
    // Message item done
    mockSSE({
      item: {
        id: textItemId,
        content: [
          {
            annotations: [],
            text: continuationText,
            type: 'output_text',
            logprobs: null,
          },
        ],
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
      output_index: 1,
      sequence_number: 4,
      type: 'response.output_item.done',
    }),
    // Response completed
    mockSSE({
      response: {
        id: responseId,
        created_at: Date.now() / 1000,
        error: null,
        model: 'databricks-claude-3-7-sonnet',
        object: 'response',
        output: [
          {
            type: 'mcp_approval_response',
            id: approvalResponseId,
            approval_request_id: requestId,
            approve: true,
            reason: null,
          },
          {
            id: textItemId,
            content: [
              {
                annotations: [],
                text: continuationText,
                type: 'output_text',
                logprobs: null,
              },
            ],
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
        ],
        usage: {
          input_tokens: 150,
          output_tokens: 30,
          total_tokens: 180,
        },
      },
      sequence_number: 5,
      type: 'response.completed',
    }),
  ];
}

/**
 * Generate a mock Responses API stream for an MCP approval response (denied).
 */
export function mockMcpApprovalDeniedStream(options?: {
  requestId?: string;
  continuationText?: string;
}): string[] {
  const {
    requestId = '__fake_mcp_request_id__',
    continuationText = "I understand. I won't execute that tool.",
  } = options ?? {};

  const responseId = generateUUID();
  const approvalResponseId = generateUUID();
  const textItemId = generateUUID();

  return [
    // Response created
    mockSSE({
      response: {
        id: responseId,
        created_at: Date.now() / 1000,
        error: null,
        model: 'databricks-claude-3-7-sonnet',
        object: 'response',
        output: [],
      },
      sequence_number: 0,
      type: 'response.created',
    }),
    // MCP approval response (denied)
    mockSSE({
      item: {
        type: 'mcp_approval_response',
        id: approvalResponseId,
        approval_request_id: requestId,
        approve: false,
        reason: 'User denied the request',
      },
      output_index: 0,
      sequence_number: 1,
      type: 'response.output_item.done',
    }),
    // Message item added
    mockSSE({
      item: {
        id: textItemId,
        content: [],
        role: 'assistant',
        status: 'in_progress',
        type: 'message',
      },
      output_index: 1,
      sequence_number: 2,
      type: 'response.output_item.added',
    }),
    // Text delta
    mockSSE({
      content_index: 0,
      delta: continuationText,
      item_id: textItemId,
      logprobs: [],
      output_index: 1,
      sequence_number: 3,
      type: 'response.output_text.delta',
    }),
    // Message item done
    mockSSE({
      item: {
        id: textItemId,
        content: [
          {
            annotations: [],
            text: continuationText,
            type: 'output_text',
            logprobs: null,
          },
        ],
        role: 'assistant',
        status: 'completed',
        type: 'message',
      },
      output_index: 1,
      sequence_number: 4,
      type: 'response.output_item.done',
    }),
    // Response completed
    mockSSE({
      response: {
        id: responseId,
        created_at: Date.now() / 1000,
        error: null,
        model: 'databricks-claude-3-7-sonnet',
        object: 'response',
        output: [
          {
            type: 'mcp_approval_response',
            id: approvalResponseId,
            approval_request_id: requestId,
            approve: false,
            reason: 'User denied the request',
          },
          {
            id: textItemId,
            content: [
              {
                annotations: [],
                text: continuationText,
                type: 'output_text',
                logprobs: null,
              },
            ],
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
        ],
        usage: {
          input_tokens: 150,
          output_tokens: 25,
          total_tokens: 175,
        },
      },
      sequence_number: 5,
      type: 'response.completed',
    }),
  ];
}

// Skips
export function skipInEphemeralMode(test: TestType<any, any>) {
  test.skip(
    process.env.TEST_MODE === 'ephemeral',
    'Skipping test in ephemeral mode',
  );
}

export function skipInWithDatabaseMode(test: TestType<any, any>) {
  test.skip(
    process.env.TEST_MODE === 'with-db',
    'Skipping test in with database mode',
  );
}
