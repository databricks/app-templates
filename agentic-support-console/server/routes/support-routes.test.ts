import type { Application, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { setupSupportRoutes } from './support-routes';

type Handler = (req: Request, res: Response) => Promise<void>;

interface FakeResponse {
  statusCode: number;
  body: unknown;
  status(code: number): FakeResponse;
  json(payload: unknown): FakeResponse;
}

const CASE_ID = '76d91972-1f20-42db-a0ce-4947e5d45b7b';
const ORDER_ID = '5b0d3a8e-0c1f-4a7e-9d47-2f7d1c0e9a11';

async function submitDecision(latestOrder: Record<string, unknown> | undefined, body: Record<string, unknown>) {
  const queries: { text: string; params?: unknown[] }[] = [];
  const handlers = new Map<string, Handler>();
  const register = (method: string) => (path: string, handler: Handler) => handlers.set(`${method} ${path}`, handler);

  await setupSupportRoutes({
    lakebase: {
      query(text, params) {
        queries.push({ text, params });
        if (text.includes('information_schema.tables')) return Promise.resolve({ rows: [{}] });
        if (text.includes('FROM public.support_cases WHERE id'))
          return Promise.resolve({ rows: [{ user_id: 'user-1' }] });
        if (text.includes('FROM public.orders')) return Promise.resolve({ rows: latestOrder ? [latestOrder] : [] });
        if (text.includes('FROM public.admins')) return Promise.resolve({ rows: [{ id: 'admin-1' }] });
        if (text.includes('INSERT INTO support_console.admin_decisions')) {
          return Promise.resolve({ rows: [{ decision: { admin_amount_cents: params?.[2] }, message: null }] });
        }
        return Promise.resolve({ rows: [] });
      },
    },
    server: {
      extend(fn) {
        fn({ get: register('GET'), post: register('POST'), patch: register('PATCH') } as unknown as Application);
      },
    },
  });
  queries.length = 0;

  const res: FakeResponse = {
    statusCode: 200,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  const handler = handlers.get('POST /api/cases/:caseId/decision');
  if (!handler) throw new Error('decision route not registered');
  await handler(
    {
      params: { caseId: CASE_ID },
      body: { case_id: CASE_ID, admin_response: 'Sorry about that.', ...body },
    } as unknown as Request,
    res as unknown as Response
  );

  const insertParams = (table: string) => queries.find((q) => q.text.includes(`INSERT INTO ${table}`))?.params;
  const writes = queries.filter((q) => /^\s*(WITH|INSERT|UPDATE)\b/.test(q.text));
  return { res, writes, insertParams };
}

describe('POST /api/cases/:caseId/decision', () => {
  it('rejects a credit above the most recent order total without writing anything', async () => {
    const { res, writes } = await submitDecision(
      { id: ORDER_ID, total_in_cents: 4200 },
      { admin_action: 'credit', admin_amount_cents: 5000 }
    );
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ max_amount_cents: 4200 });
    expect(writes).toEqual([]);
  });

  it('rejects a refund above the most recent order total without writing anything', async () => {
    const { res, writes } = await submitDecision(
      { id: ORDER_ID, total_in_cents: 4200 },
      { admin_action: 'refund', admin_amount_cents: 5000 }
    );
    expect(res.statusCode).toBe(422);
    expect(writes).toEqual([]);
  });

  it('rejects a credit when the most recent order has no total', async () => {
    const { res, writes } = await submitDecision(
      { id: ORDER_ID, total_in_cents: null },
      { admin_action: 'credit', admin_amount_cents: 500 }
    );
    expect(res.statusCode).toBe(422);
    expect(writes).toEqual([]);
  });

  it('logs, applies and returns the same amount for a credit within the cap', async () => {
    const { res, insertParams } = await submitDecision(
      { id: ORDER_ID, total_in_cents: 4200 },
      { admin_action: 'credit', admin_amount_cents: 500 }
    );
    expect(res.statusCode).toBe(201);
    expect(insertParams('support_console.admin_decisions')?.[2]).toBe(500);
    expect(insertParams('public.credits')?.[2]).toBe(500);
    expect(res.body).toMatchObject({ admin_amount_cents: 500 });
  });

  it('refunds the requested amount against the most recent order', async () => {
    const { res, insertParams } = await submitDecision(
      { id: ORDER_ID, total_in_cents: 4200 },
      { admin_action: 'refund', admin_amount_cents: 4200 }
    );
    expect(res.statusCode).toBe(201);
    expect(insertParams('support_console.admin_decisions')?.[2]).toBe(4200);
    expect(insertParams('public.refunds')?.slice(1, 4)).toEqual([ORDER_ID, CASE_ID, 4200]);
  });
});
