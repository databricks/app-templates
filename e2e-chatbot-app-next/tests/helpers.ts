import type {
  FmapiChunk,
  FmapiResponse,
} from '@/databricks/providers/databricks-provider/fmapi-language-model/fmapi-schema';
import { generateUUID } from '@/lib/utils';
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
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
    start(controller) {
      for (const s of SSEs) {
        controller.enqueue(encoder.encode(`${s}\n\n`));
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
  id: FmapiChunk['id'],
  delta: FmapiChunk['choices'][number]['delta'],
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
export function mockFmapiResponseObject(
  content: FmapiResponse['choices'][number]['message']['content'],
): FmapiResponse {
  return {
    id: generateUUID(),
    created: Date.now(),
    model: 'chat-model',
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    choices: [{ message: { role: 'assistant', content } }],
  };
}
