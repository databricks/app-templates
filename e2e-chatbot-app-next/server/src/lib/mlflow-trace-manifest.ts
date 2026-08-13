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
  const response = await fetch(
    `${hostUrl}/api/3.0/mlflow/traces/${encodeURIComponent(traceId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(
      `MLflow trace ${traceId} retrieval failed: ${response.status}`,
    );
  }
  const payload = objectValue(await response.json());
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
    const attributes = objectValue(span.attributes);
    const spanType = String(
      span.span_type ?? attributes['mlflow.spanType'] ?? '',
    );
    const usage = objectValue(
      attributes[
        spanType === 'AGENT'
          ? 'mlflow.trace.tokenUsage'
          : 'mlflow.chat.tokenUsage'
      ] ?? attributes['appkit.usage'],
    );
    const status = objectValue(span.status);
    return {
      name: span.name,
      span_type: spanType,
      span_id: span.span_id,
      parent_span_id: span.parent_span_id ?? null,
      inputs: span.inputs ?? attributes['mlflow.spanInputs'],
      outputs: span.outputs ?? attributes['mlflow.spanOutputs'],
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
      links: Array.isArray(span.links) ? span.links : [],
      attributes: {
        ...attributes,
        ...(spanType === 'AGENT'
          ? {
              app_id:
                attributes.app_id ??
                attributes['appkit.app.name'] ??
                info.app_id,
              user_id:
                attributes.user_id ??
                attributes['mlflow.trace.user'] ??
                info.user_id,
              session_id:
                attributes.session_id ??
                attributes['mlflow.trace.session'] ??
                info.session_id,
            }
          : {}),
      },
    };
  });
  await writeFile(
    destination,
    `${JSON.stringify({ template, trace_id: storedTraceId, spans }, null, 2)}\n`,
  );
}
