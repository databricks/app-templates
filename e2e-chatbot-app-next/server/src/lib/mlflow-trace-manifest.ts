import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

type RawSpan = {
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string | null;
  name?: string;
  span_type?: string;
  inputs?: unknown;
  outputs?: unknown;
  status?: { status_code?: string; code?: string } | string;
  latency_ms?: number;
  links?: Array<Record<string, unknown>>;
  attributes?: Record<string, unknown>;
};

const objectValue = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};

const MAX_CAPTURE_BYTES = 64 * 1024;
const MAX_ERROR_BYTES = 2 * 1024;
const SECRET_TEXT =
  /(\b(?:authorization|api[-_\s]?key|cookie|credential|password|secret|token)\b["']?\s*(?::|=|\s+(?:is\s+)?)\s*)(?:(["'])(?:bearer\s+)?((?:\\.|(?!\2)[^\\])*)\2|(?:bearer\s+)?([^\s,;)\]}]+))/gi;

function redactText(value: string): string {
  return value.replace(
    SECRET_TEXT,
    (_match, prefix: string, quote?: string) =>
      `${prefix}${quote ?? ''}[REDACTED]${quote ?? ''}`,
  );
}

function isSecretKey(key: string): boolean {
  return (
    /(?:authorization|api[-_\s]?key|cookie|credential|password|secret)/i.test(
      key,
    ) ||
    /(?:^|[._-])token(?:$|[._-])/i.test(key) ||
    /token$/i.test(key)
  );
}

function jsonable(value: unknown, seen = new WeakSet<object>()): unknown {
  try {
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      return value;
    }
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return redactText(value);
    if (typeof value === 'undefined') return null;
    if (typeof value === 'function' || typeof value === 'symbol') {
      return redactText(String(value));
    }
    if (value instanceof Error) {
      return { name: value.name, message: redactText(value.message) };
    }
    if (value instanceof Uint8Array) {
      return redactText(Buffer.from(value).toString('utf8'));
    }
    if (Array.isArray(value)) {
      return value.map((item) => jsonable(item, seen));
    }
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Map) {
      return jsonable(Object.fromEntries(value), seen);
    }
    if (value instanceof Set)
      return [...value].map((item) => jsonable(item, seen));
    if (typeof value === 'object') {
      if (seen.has(value)) return '<Circular>';
      seen.add(value);
      const record = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        result[key] = isSecretKey(key)
          ? '[REDACTED]'
          : jsonable(record[key], seen);
      }
      seen.delete(value);
      return result;
    }
    return redactText(String(value));
  } catch (error) {
    return `<${typeof value}: ${error instanceof Error ? error.name : 'Error'}>`;
  }
}

export function safeTraceValue(
  value: unknown,
  maxBytes = MAX_CAPTURE_BYTES,
): unknown {
  const redacted = jsonable(value);
  const encoded = Buffer.from(JSON.stringify(redacted), 'utf8');
  if (encoded.byteLength <= maxBytes) return redacted;

  let previewBytes = encoded.subarray(0, maxBytes);
  let preview = previewBytes.toString('utf8');
  while (preview.endsWith('�') && previewBytes.length > 0) {
    previewBytes = previewBytes.subarray(0, previewBytes.length - 1);
    preview = previewBytes.toString('utf8');
  }
  return {
    truncated: true,
    originalBytes: encoded.byteLength,
    sha256: createHash('sha256').update(encoded).digest('hex'),
    preview,
  };
}

function safeError(error: unknown): string {
  const message = redactText(
    error instanceof Error ? error.message : String(error),
  );
  const safe = safeTraceValue(message, MAX_ERROR_BYTES);
  return typeof safe === 'string' ? safe : JSON.stringify(safe);
}

function safeLinks(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((link) => {
    const record = objectValue(link);
    return Object.fromEntries(
      Object.entries(record).map(([key, nested]) => [
        key,
        key === 'trace_id' ||
        key === 'traceId' ||
        key === 'span_id' ||
        key === 'spanId'
          ? nested
          : safeTraceValue(nested),
      ]),
    );
  });
}

export async function captureRemoteTraceManifest({
  traceId,
  hostUrl,
  token,
  destination,
  template,
}: {
  traceId: string;
  hostUrl: string;
  token: string;
  destination: string;
  template: string;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `${hostUrl}/api/3.0/mlflow/traces/${encodeURIComponent(traceId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (error) {
    throw new Error(`MLflow trace retrieval failed: ${safeError(error)}`);
  }
  if (!response.ok) {
    throw new Error(
      `MLflow trace ${traceId} retrieval failed: ${response.status}`,
    );
  }
  let payload: Record<string, unknown>;
  try {
    payload = objectValue(await response.json());
  } catch (error) {
    throw new Error(`MLflow trace payload is malformed: ${safeError(error)}`);
  }
  const trace = objectValue(payload.trace ?? payload);
  const info = objectValue(trace.trace_info ?? trace.info);
  const storedTraceId = String(info.trace_id ?? info.traceId ?? '');
  if (storedTraceId !== traceId) {
    throw new Error(
      `returned remote trace ${traceId} does not match retrieved trace ${storedTraceId}`,
    );
  }
  const data = objectValue(trace.data);
  const rawSpans = Array.isArray(data.spans) ? (data.spans as RawSpan[]) : [];
  const spans = rawSpans.map((span) => {
    const rawAttributes = objectValue(span.attributes);
    const spanType = String(
      span.span_type ?? rawAttributes['mlflow.spanType'] ?? '',
    );
    const status = objectValue(span.status);
    const enrichedAttributes = {
      ...rawAttributes,
      ...(spanType === 'AGENT'
        ? {
            app_id:
              rawAttributes.app_id ??
              rawAttributes['appkit.app.name'] ??
              info.app_id,
            user_id:
              rawAttributes.user_id ??
              rawAttributes['mlflow.trace.user'] ??
              info.user_id,
            session_id:
              rawAttributes.session_id ??
              rawAttributes['mlflow.trace.session'] ??
              info.session_id,
          }
        : {}),
    };
    const attributes = Object.fromEntries(
      Object.entries(enrichedAttributes).map(([key, value]) => [
        key,
        isSecretKey(key) ? '[REDACTED]' : safeTraceValue(value),
      ]),
    );
    const usage = objectValue(
      attributes[
        spanType === 'AGENT'
          ? 'mlflow.trace.tokenUsage'
          : 'mlflow.chat.tokenUsage'
      ] ?? attributes['appkit.usage'],
    );
    return {
      name: span.name,
      span_type: spanType,
      span_id: span.span_id,
      parent_span_id: span.parent_span_id ?? null,
      inputs: safeTraceValue(span.inputs ?? rawAttributes['mlflow.spanInputs']),
      outputs: safeTraceValue(
        span.outputs ?? rawAttributes['mlflow.spanOutputs'],
      ),
      status:
        typeof span.status === 'string'
          ? span.status
          : (status.status_code ?? status.code),
      latency_ms: span.latency_ms,
      model:
        attributes['mlflow.chat.model'] ?? attributes['appkit.model'] ?? null,
      provider:
        attributes['mlflow.chat.provider'] ??
        attributes['appkit.provider'] ??
        null,
      usage: {
        input_tokens: usage.input_tokens ?? usage.inputTokens,
        output_tokens: usage.output_tokens ?? usage.outputTokens,
        total_tokens: usage.total_tokens ?? usage.totalTokens,
      },
      cost_usd: attributes['mlflow.llm.cost'] ?? null,
      cost_available:
        attributes['appkit.cost.available'] ??
        attributes['appkit.cost_available'] ??
        false,
      links: safeLinks(span.links),
      attributes,
    };
  });
  await writeFile(
    destination,
    `${JSON.stringify({ template, trace_id: storedTraceId, spans }, null, 2)}\n`,
  );
}
