import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { captureRemoteTraceManifest } from '../../server/src/lib/mlflow-trace-manifest';

const TRACE_ID =
  'trace:/main.agent_traces.next/0123456789abcdef0123456789abcdef';
const SPAN_ID = '0123456789abcdef';

let temporaryDirectory: string | undefined;
const originalFetch = globalThis.fetch;

test.afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

async function destination(): Promise<string> {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'next-trace-manifest-'));
  return join(temporaryDirectory, 'manifest.json');
}

test('remote manifest bounds and redacts every captured field without changing provider data or semantic scalars', async () => {
  const secrets = [
    'authorization-secret',
    'cookie-secret',
    'api-key-secret',
    'sdk-token-secret',
    'password-secret',
    'credential-secret',
    'nested-secret',
    'natural-secret',
  ];
  const hugeSecret = `Authorization: Bearer ${'utf8-secret-😀'.repeat(8_000)}`;
  const payload = {
    trace: {
      trace_info: { trace_id: TRACE_ID },
      data: {
        spans: [
          {
            trace_id: TRACE_ID,
            span_id: SPAN_ID,
            parent_span_id: null,
            name: 'agent',
            span_type: 'AGENT',
            inputs: {
              authorization: `Bearer ${secrets[0]}`,
              cookie: secrets[1],
              api_key: secrets[2],
              sdkToken: secrets[3],
              password: secrets[4],
              credentials: secrets[5],
              nested: { secret: secrets[6] },
              note: `the credential is ${secrets[7]}`,
              hugeSecret,
              oversized: '😀'.repeat(20_000),
            },
            outputs: {
              result: 'ok',
              note: 'password="output-secret"',
            },
            status: { status_code: 'OK' },
            latency_ms: 12.5,
            links: [
              {
                trace_id: 'fedcba9876543210fedcba9876543210',
                span_id: 'fedcba9876543210',
                attributes: { token: 'link-secret' },
              },
            ],
            attributes: {
              'mlflow.spanType': 'AGENT',
              'mlflow.trace.tokenUsage': {
                input_tokens: 7,
                output_tokens: 11,
                total_tokens: 18,
              },
              'mlflow.llm.cost': 0.0125,
              'appkit.cost.available': true,
              apiKey: 'attribute-secret',
              detail: 'Authorization: Bearer attribute-natural-secret',
              payload: '😀'.repeat(20_000),
              arbitrary: new (class ArbitraryCapture {
                value = 'safe';
                password = 'arbitrary-secret';
              })(),
            },
          },
        ],
      },
    },
  };
  const originalPayload = structuredClone(payload);
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => payload,
  })) as typeof fetch;
  const output = await destination();

  await captureRemoteTraceManifest({
    traceId: TRACE_ID,
    hostUrl: 'https://workspace.example',
    token: 'request-token-must-not-be-captured',
    destination: output,
    template: 'e2e-chatbot-app-next',
  });

  const manifestText = await readFile(output, 'utf8');
  const manifest = JSON.parse(manifestText);
  const span = manifest.spans[0];
  expect(manifest.trace_id).toBe(TRACE_ID);
  expect(span.span_id).toBe(SPAN_ID);
  expect(span.parent_span_id).toBeNull();
  expect(span.latency_ms).toBe(12.5);
  expect(span.usage).toEqual({
    input_tokens: 7,
    output_tokens: 11,
    total_tokens: 18,
  });
  expect(span.cost_usd).toBe(0.0125);
  expect(span.cost_available).toBe(true);
  expect(span.attributes.payload).toEqual({
    truncated: true,
    originalBytes: expect.any(Number),
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    preview: expect.any(String),
  });
  expect(span.links[0].trace_id).toBe('fedcba9876543210fedcba9876543210');
  expect(span.links[0].span_id).toBe('fedcba9876543210');
  expect(span.inputs).toEqual({
    truncated: true,
    originalBytes: expect.any(Number),
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    preview: expect.any(String),
  });
  expect(Buffer.byteLength(span.inputs.preview, 'utf8')).toBeLessThanOrEqual(
    64 * 1024,
  );
  for (const secret of [
    ...secrets,
    'utf8-secret',
    'output-secret',
    'link-secret',
    'attribute-secret',
    'attribute-natural-secret',
    'arbitrary-secret',
    'request-token-must-not-be-captured',
  ]) {
    expect(manifestText).not.toContain(secret);
  }
  expect(payload).toEqual(originalPayload);
});

test('provider and malformed-payload errors are bounded and credential-redacted', async () => {
  const output = await destination();
  globalThis.fetch = (async () => {
    throw new Error(
      `Authorization: Bearer ${'network-secret-😀'.repeat(1_000)}`,
    );
  }) as typeof fetch;

  const providerError = await captureRemoteTraceManifest({
    traceId: TRACE_ID,
    hostUrl: 'https://workspace.example',
    token: 'request-secret',
    destination: output,
    template: 'e2e-chatbot-app-next',
  }).catch((error: unknown) => String(error));
  expect(providerError).not.toContain('network-secret');
  expect(Buffer.byteLength(providerError, 'utf8')).toBeLessThan(3_000);

  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => {
      throw new Error('password=malformed-payload-secret');
    },
  })) as typeof fetch;
  const malformedError = await captureRemoteTraceManifest({
    traceId: TRACE_ID,
    hostUrl: 'https://workspace.example',
    token: 'request-secret',
    destination: output,
    template: 'e2e-chatbot-app-next',
  }).catch((error: unknown) => String(error));
  expect(malformedError).not.toContain('malformed-payload-secret');
  expect(malformedError).toContain('[REDACTED]');
});
