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
