import { expect, test } from 'vitest';

const required = [
  'RAG_CHAT_APP_URL',
  'RAG_CHAT_APP_TOKEN',
  'RAG_CHAT_DEPLOYED_CHAT_ID',
  'DATABRICKS_HOST',
  'DATABRICKS_TOKEN',
  'MLFLOW_EXPERIMENT_ID',
  'MLFLOW_TRACING_SQL_WAREHOUSE_ID',
  'MLFLOW_OTEL_SPANS_TABLE',
] as const;
const missing = required.filter((name) => !process.env[name]);

test.skipIf(missing.length > 0)('deployed RAG request is the exact MLflow and UC trace', async () => {
  const response = await fetch(`${process.env.RAG_CHAT_APP_URL}/api/chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RAG_CHAT_APP_TOKEN}`,
      'content-type': 'application/json',
      'x-request-id': 'rag-deployed-conformance',
    },
    body: JSON.stringify({
      chatId: process.env.RAG_CHAT_DEPLOYED_CHAT_ID,
      messages: [
        {
          id: 'rag-deployed-conformance',
          role: 'user',
          parts: [{ type: 'text', text: 'What is a lakehouse?' }],
        },
      ],
    }),
  });
  expect(response.ok).toBe(true);
  await response.text();
  const traceId = response.headers.get('x-mlflow-trace-id');
  expect(traceId).toBeTruthy();

  const host = process.env.DATABRICKS_HOST!.replace(/\/$/, '');
  const headers = {
    authorization: `Bearer ${process.env.DATABRICKS_TOKEN}`,
    'content-type': 'application/json',
  };
  const mlflowResponse = await fetch(`${host}/api/2.0/mlflow/traces/${encodeURIComponent(traceId!)}`, { headers });
  expect(mlflowResponse.ok).toBe(true);
  const mlflowTrace: any = await mlflowResponse.json();
  expect(String(mlflowTrace.trace?.info?.experiment_id ?? mlflowTrace.trace?.trace_info?.experiment_id)).toBe(
    process.env.MLFLOW_EXPERIMENT_ID
  );
  const mlflowSpans = mlflowTrace.trace?.data?.spans ?? mlflowTrace.trace?.trace_data?.spans ?? [];
  expect(mlflowSpans.some((span: any) => span.attributes?.['mlflow.spanType'] === 'AGENT')).toBe(true);
  expect(mlflowSpans.some((span: any) => span.attributes?.['mlflow.spanType'] === 'CHAT_MODEL')).toBe(true);

  const experimentResponse = await fetch(
    `${host}/api/2.0/mlflow/experiments/get?experiment_id=${encodeURIComponent(process.env.MLFLOW_EXPERIMENT_ID!)}`,
    { headers }
  );
  expect(experimentResponse.ok).toBe(true);
  const experiment: any = await experimentResponse.json();
  expect(experiment.experiment?.trace_location?.full_otel_spans_table_name).toBe(process.env.MLFLOW_OTEL_SPANS_TABLE);

  const statement = await fetch(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      warehouse_id: process.env.MLFLOW_TRACING_SQL_WAREHOUSE_ID,
      statement:
        'SELECT trace_id, span_id, parent_span_id, name, attributes\n' +
        'FROM IDENTIFIER(:otel_spans_table)\n' +
        'WHERE trace_id = :trace_id\n' +
        'ORDER BY start_time_unix_nano',
      parameters: [
        { name: 'otel_spans_table', type: 'STRING', value: process.env.MLFLOW_OTEL_SPANS_TABLE },
        { name: 'trace_id', type: 'STRING', value: traceId },
      ],
      wait_timeout: '50s',
    }),
  });
  expect(statement.ok).toBe(true);
  let uc: any = await statement.json();
  const deadline = Date.now() + 120_000;
  while (['PENDING', 'RUNNING'].includes(uc.status?.state) && Date.now() < deadline) {
    expect(uc.statement_id).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const poll = await fetch(`${host}/api/2.0/sql/statements/${uc.statement_id}`, { headers });
    expect(poll.ok).toBe(true);
    uc = await poll.json();
  }
  expect(uc.status?.state).toBe('SUCCEEDED');
  const ucSpanIds = (uc.result?.data_array ?? []).map((row: unknown[]) => String(row[1])).sort();
  const mlflowSpanIds = mlflowSpans.map((span: any) => String(span.span_id ?? span.spanId)).sort();
  expect(ucSpanIds).toEqual(mlflowSpanIds);
});
