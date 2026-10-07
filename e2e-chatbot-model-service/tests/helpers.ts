import { generateUUID } from '@chat-template/core';
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
  TestType,
} from '@playwright/test';

// ============================================================================
// SSE Parsing Helpers
// ============================================================================

/**
 * Parse SSE lines and return only the `data:` payloads as parsed objects.
 * Shared across route test files to avoid duplication.
 */
export function parseSSEPayloads(body: string): unknown[] {
  return body
    .split('\n')
    .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
    .map((l) => {
      try {
        return JSON.parse(l.slice(6));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Send a chat message via POST /api/chat and return the assistant message ID
 * from the `start` SSE event. Throws if the request fails or the event is missing.
 */
export async function sendChatAndGetMessageId(
  request: APIRequestContext,
  chatId: string,
  message: unknown,
): Promise<string> {
  const chatResponse = await request.post('/api/chat', {
    data: {
      id: chatId,
      message,
      selectedChatModel: 'chat-model',
      selectedVisibilityType: 'private',
    },
  });

  if (chatResponse.status() !== 200) {
    throw new Error(
      `Expected 200 from /api/chat, got ${chatResponse.status()}`,
    );
  }

  const body = await chatResponse.text();
  const payloads = parseSSEPayloads(body);
  const startEvent = payloads.find(
    (p) => (p as any)?.type === 'start' && (p as any)?.messageId,
  ) as { type: string; messageId: string } | undefined;

  if (!startEvent?.messageId) {
    throw new Error(
      `Expected a 'start' SSE event with messageId. Got payloads: ${JSON.stringify(payloads.map((p) => (p as any)?.type))}`,
    );
  }

  return startEvent.messageId;
}

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

/**
 * Create a 200 SSE response whose body stream errors immediately.
 * This simulates a connection that opens successfully but breaks before
 * any model data arrives, triggering the stream-error → fallback path.
 */
export function createMockImmediateStreamErrorResponse(): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error('Mock upstream connection error'));
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
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
