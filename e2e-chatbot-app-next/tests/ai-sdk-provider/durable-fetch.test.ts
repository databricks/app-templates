import { expect, test } from '@playwright/test';
import { databricksFetch } from '@chat-template/ai-sdk-providers';

/**
 * Tests for the durable-execution glue inside `databricksFetch`:
 *   - `background: true` injection on streaming requests when `API_PROXY` is set
 *   - SSE response wrapping that auto-resumes from
 *     `GET /responses/{id}?stream=true&starting_after=<seq>` when the upstream
 *     stream closes without `[DONE]`
 *
 * Each test stashes and restores the global fetch + the API_PROXY env var so
 * tests don't leak state into each other.
 */

const ORIG_FETCH = globalThis.fetch;
const ORIG_API_PROXY = process.env.API_PROXY;

function sseChunk(obj: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function sseDone(): Uint8Array {
  return new TextEncoder().encode('data: [DONE]\n\n');
}

function makeSseResponse(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function readSseFrames(
  body: ReadableStream<Uint8Array>,
): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const frames: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  for (const line of buf.split('\n')) {
    const t = line.trim();
    if (t.startsWith('data:')) frames.push(t.slice(5).trim());
  }
  return frames;
}

test.afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
  process.env.API_PROXY = ORIG_API_PROXY ?? '';
});

test.describe('background: true injection', () => {
  test('injects background=true when API_PROXY is set + stream=true', async () => {
    process.env.API_PROXY = 'http://localhost:8000/invocations';
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await databricksFetch('http://localhost:8000/invocations', {
      method: 'POST',
      body: JSON.stringify({ input: [], stream: true }),
    });

    expect(capturedBody?.background).toBe(true);
    expect(capturedBody?.stream).toBe(true);
  });

  test('leaves background alone when API_PROXY is NOT set', async () => {
    process.env.API_PROXY = '';
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await databricksFetch(
      'http://example.com/serving-endpoints/x/invocations',
      {
        method: 'POST',
        body: JSON.stringify({ input: [], stream: true }),
      },
    );

    expect(capturedBody?.background).toBeUndefined();
  });

  test('leaves background alone for non-streaming requests', async () => {
    process.env.API_PROXY = 'http://localhost:8000/invocations';
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await databricksFetch('http://localhost:8000/invocations', {
      method: 'POST',
      body: JSON.stringify({ input: [], stream: false }),
    });

    expect(capturedBody?.background).toBeUndefined();
  });
});

test.describe('durable resume on stream close-without-DONE', () => {
  test('fires GET retrieve with starting_after=<lastSeq> when SSE ends without DONE', async () => {
    process.env.API_PROXY = 'http://localhost:8000/invocations';

    const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = input.toString();
      fetchCalls.push({ url, init });

      if (init?.method === 'GET') {
        // resume call — return the rest of the stream + DONE
        return makeSseResponse([
          sseChunk({
            type: 'response.output_text.delta',
            sequence_number: 3,
            response_id: 'resp_abc',
          }),
          sseChunk({
            type: 'response.completed',
            sequence_number: 4,
            response_id: 'resp_abc',
          }),
          sseDone(),
        ]);
      }
      // initial POST — return a stream that closes WITHOUT [DONE]
      return makeSseResponse([
        sseChunk({
          type: 'response.created',
          sequence_number: 0,
          response_id: 'resp_abc',
        }),
        sseChunk({
          type: 'response.output_text.delta',
          sequence_number: 1,
          response_id: 'resp_abc',
        }),
        sseChunk({
          type: 'response.output_text.delta',
          sequence_number: 2,
          response_id: 'resp_abc',
        }),
      ]);
    }) as typeof fetch;

    const response = await databricksFetch(
      'http://localhost:8000/invocations',
      {
        method: 'POST',
        body: JSON.stringify({ input: [], stream: true }),
        headers: { Authorization: 'Bearer tok-123' },
      },
    );

    // Drain the wrapped body — this is what triggers the resume internally.
    if (!response.body) throw new Error('expected response.body');
    const frames = await readSseFrames(response.body);

    // Two fetches: initial POST + one GET resume.
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[0]?.init?.method).toBe('POST');
    expect(fetchCalls[1]?.init?.method).toBe('GET');
    expect(fetchCalls[1]?.url).toContain('/responses/resp_abc');
    expect(fetchCalls[1]?.url).toContain('starting_after=2');

    // Frames from both halves end up downstream.
    expect(frames.some((f) => f.includes('"sequence_number":1'))).toBe(true);
    expect(frames.some((f) => f.includes('"sequence_number":3'))).toBe(true);
    expect(frames).toContain('[DONE]');
  });

  test('resume request carries ONLY the Authorization header', async () => {
    process.env.API_PROXY = 'http://localhost:8000/invocations';

    const resumeHeaders = new Headers();
    let resumeHeadersCaptured = false;
    globalThis.fetch = (async (_input, init) => {
      if (init?.method === 'GET') {
        for (const [k, v] of new Headers(init.headers)) resumeHeaders.set(k, v);
        resumeHeadersCaptured = true;
        return makeSseResponse([sseDone()]);
      }
      return makeSseResponse([
        sseChunk({
          type: 'response.created',
          sequence_number: 0,
          response_id: 'resp_xyz',
        }),
      ]);
    }) as typeof fetch;

    const response = await databricksFetch(
      'http://localhost:8000/invocations',
      {
        method: 'POST',
        body: JSON.stringify({ input: [], stream: true }),
        headers: {
          Authorization: 'Bearer tok-xyz',
          'content-type': 'application/json',
          'x-mlflow-return-trace-id': 'true',
          'x-some-other-header': 'leakage',
        },
      },
    );
    if (response.body) await readSseFrames(response.body);

    expect(resumeHeadersCaptured).toBe(true);
    expect(resumeHeaders.get('authorization')).toBe('Bearer tok-xyz');
    expect(resumeHeaders.get('content-type')).toBeNull();
    expect(resumeHeaders.get('x-mlflow-return-trace-id')).toBeNull();
    expect(resumeHeaders.get('x-some-other-header')).toBeNull();
  });

  test('does NOT wrap SSE responses when API_PROXY is unset', async () => {
    process.env.API_PROXY = '';

    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      // Return a stream that closes without [DONE]. If we were wrapping,
      // this would trigger a resume fetch and bump the count.
      return makeSseResponse([
        sseChunk({
          type: 'response.created',
          sequence_number: 0,
          response_id: 'resp_no_wrap',
        }),
      ]);
    }) as typeof fetch;

    const response = await databricksFetch(
      'http://example.com/serving-endpoints/x/invocations',
      {
        method: 'POST',
        body: JSON.stringify({ input: [], stream: true }),
      },
    );
    if (response.body) await readSseFrames(response.body);

    expect(fetchCount).toBe(1);
  });
});
