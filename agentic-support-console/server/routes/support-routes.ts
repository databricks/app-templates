import { z } from 'zod';
import { Application } from 'express';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const ADMIN_DECISIONS_EXISTS_SQL = `
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'support_console' AND table_name = 'admin_decisions'
`;

const SETUP_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS support_console`;

const CREATE_DECISIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS support_console.admin_decisions (
    id SERIAL PRIMARY KEY,
    case_id BYTEA NOT NULL,
    admin_action TEXT NOT NULL,
    admin_amount_cents INTEGER NOT NULL DEFAULT 0,
    admin_response TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const SubmitDecisionBody = z.object({
  case_id: z.string().min(1),
  admin_action: z.enum(['refund', 'credit', 'no_action', 'escalate', 'resolve']),
  admin_amount_cents: z.number().int().min(0),
  admin_response: z.string().min(1),
});

const UpdateStatusBody = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
});

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

export async function setupSupportRoutes(appkit: AppKitWithLakebase) {
  try {
    const { rows } = await appkit.lakebase.query(ADMIN_DECISIONS_EXISTS_SQL);
    if (rows.length > 0) {
      console.log('[support] Table support_console.admin_decisions already exists');
    } else {
      await appkit.lakebase.query(SETUP_SCHEMA_SQL);
      await appkit.lakebase.query(CREATE_DECISIONS_TABLE_SQL);
      console.log('[support] Created schema and table support_console.admin_decisions');
    }
  } catch (err) {
    console.warn('[support] Database setup failed:', (err as Error).message);
  }

  appkit.server.extend((app) => {
    app.get('/api/cases', async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            sc.id::text AS case_id,
            sc.user_id,
            u.name AS user_name,
            u.email AS user_email,
            sc.subject,
            sc.status,
            sc.created_at AS case_created_at,
            COALESCE(ms.message_count, 0) AS message_count,
            COALESCE(ms.has_admin_reply, false) AS has_admin_reply,
            ms.first_response_minutes,
            ar.suggested_action,
            ar.suggested_amount_cents,
            ar.case_summary
          FROM public.support_cases sc
          JOIN public.users u ON sc.user_id = u.id
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*)::int AS message_count,
              bool_or(admin_id IS NOT NULL) AS has_admin_reply,
              (EXTRACT(EPOCH FROM (
                MIN(created_at) FILTER (WHERE admin_id IS NOT NULL) - MIN(created_at)
              )) / 60)::int AS first_response_minutes
            FROM public.support_messages
            WHERE case_id = sc.id
          ) ms ON true
          LEFT JOIN LATERAL (
            SELECT suggested_action, suggested_amount_cents, case_summary
            FROM gold.support_agent_responses_sync
            WHERE encode(case_id, 'hex') = REPLACE(sc.id::text, '-', '')
            ORDER BY generated_at DESC LIMIT 1
          ) ar ON true
          ORDER BY sc.created_at DESC
        `);
        res.json(result.rows);
      } catch (err) {
        console.error('Failed to list cases:', err);
        res.status(500).json({ error: 'Failed to list cases' });
      }
    });

    app.get('/api/cases/:caseId', async (req, res) => {
      try {
        const caseId = req.params.caseId;
        const caseIdHex = caseId.replace(/-/g, '');

        const caseResult = await appkit.lakebase.query(
          `
          SELECT
            sc.id::text AS case_id,
            sc.user_id,
            u.name AS user_name,
            u.email AS user_email,
            u.region AS user_region,
            sc.subject,
            sc.status,
            sc.created_at AS case_created_at,
            COALESCE(ms.message_count, 0) AS message_count,
            COALESCE(ms.has_admin_reply, false) AS has_admin_reply,
            ms.first_response_minutes,
            COALESCE(cr.linked_refund_cents, 0) AS linked_refund_cents,
            COALESCE(cc.linked_credit_cents, 0) AS linked_credit_cents,
            COALESCE(ul.user_lifetime_spend_cents, 0) AS user_lifetime_spend_cents,
            COALESCE(urc.user_cases_90d, 0) AS user_cases_90d
          FROM public.support_cases sc
          JOIN public.users u ON sc.user_id = u.id
          LEFT JOIN LATERAL (
            SELECT
              COUNT(*)::int AS message_count,
              bool_or(admin_id IS NOT NULL) AS has_admin_reply,
              (EXTRACT(EPOCH FROM (
                MIN(created_at) FILTER (WHERE admin_id IS NOT NULL) - MIN(created_at)
              )) / 60)::int AS first_response_minutes
            FROM public.support_messages
            WHERE case_id = sc.id
          ) ms ON true
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(amount_in_cents), 0)::int AS linked_refund_cents
            FROM public.refunds WHERE support_case_id = sc.id
          ) cr ON true
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(amount_in_cents), 0)::int AS linked_credit_cents
            FROM public.credits WHERE support_case_id = sc.id
          ) cc ON true
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(total_in_cents), 0)::bigint AS user_lifetime_spend_cents
            FROM public.orders WHERE user_id = sc.user_id
          ) ul ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS user_cases_90d
            FROM public.support_cases
            WHERE user_id = sc.user_id AND created_at >= NOW() - INTERVAL '90 days'
          ) urc ON true
          WHERE sc.id = $1::uuid
        `,
          [caseId]
        );

        if (caseResult.rows.length === 0) {
          res.status(404).json({ error: 'Case not found' });
          return;
        }

        const messagesResult = await appkit.lakebase.query(
          `
          SELECT
            id::text AS id,
            CASE WHEN admin_id IS NOT NULL THEN 'admin' ELSE 'customer' END AS role,
            content,
            created_at
          FROM public.support_messages
          WHERE case_id = $1::uuid
          ORDER BY created_at ASC
        `,
          [caseId]
        );

        const agentResult = await appkit.lakebase.query(
          `
          SELECT
            encode(message_id, 'hex') AS message_id,
            case_summary,
            suggested_response,
            suggested_action,
            suggested_amount_cents,
            reasoning,
            model,
            generated_at
          FROM gold.support_agent_responses_sync
          WHERE encode(case_id, 'hex') = $1
          ORDER BY generated_at DESC
        `,
          [caseIdHex]
        );

        const userId = caseResult.rows[0].user_id as string;
        const profileResult = await appkit.lakebase.query(
          `
          SELECT
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days')::int AS total_orders_90d,
            COALESCE(SUM(total_in_cents) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days'), 0)::bigint AS total_spend_90d_cents,
            COUNT(*)::int AS lifetime_order_count,
            COALESCE(SUM(total_in_cents), 0)::bigint AS lifetime_spend_cents,
            (SELECT COUNT(*)::int FROM public.support_cases WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '90 days') AS support_cases_90d,
            (SELECT COUNT(*)::int FROM public.support_cases WHERE user_id = $1) AS support_cases_lifetime,
            COALESCE((SELECT SUM(amount_in_cents)::bigint FROM public.refunds WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '90 days'), 0) AS total_refunds_90d_cents,
            COALESCE((SELECT SUM(amount_in_cents)::bigint FROM public.credits WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '90 days'), 0) AS total_credits_90d_cents
          FROM public.orders
          WHERE user_id = $1
        `,
          [userId]
        );

        res.json({
          case: caseResult.rows[0],
          messages: messagesResult.rows,
          agentResponses: agentResult.rows,
          userProfile: profileResult.rows[0] || null,
        });
      } catch (err) {
        console.error('Failed to get case detail:', err);
        res.status(500).json({ error: 'Failed to get case detail' });
      }
    });

    app.post('/api/cases/:caseId/decision', async (req, res) => {
      try {
        const caseId = req.params.caseId;
        const parsed = SubmitDecisionBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
          return;
        }

        const caseIdBytes = uuidToBytes(caseId);

        const adminResult = await appkit.lakebase.query(`SELECT id FROM public.admins LIMIT 1`);
        const adminId = adminResult.rows.length > 0 ? (adminResult.rows[0].id as string) : null;

        const decisionResult = await appkit.lakebase.query(
          `INSERT INTO support_console.admin_decisions (id, case_id, admin_action, admin_amount_cents, admin_response)
           VALUES (
             (SELECT COALESCE(MAX(id), 0) + 1 FROM support_console.admin_decisions),
             $1, $2, $3, $4
           )
           RETURNING id, admin_action, admin_amount_cents, admin_response, created_at`,
          [caseIdBytes, parsed.data.admin_action, parsed.data.admin_amount_cents, parsed.data.admin_response]
        );

        let message: Record<string, unknown> | null = null;
        if (adminId) {
          const msgResult = await appkit.lakebase.query(
            `INSERT INTO public.support_messages (case_id, admin_id, content)
             VALUES ($1::uuid, $2::uuid, $3)
             RETURNING id::text AS id, 'admin' AS role, content, created_at`,
            [caseId, adminId, parsed.data.admin_response]
          );
          message = msgResult.rows[0] ?? null;

          if (parsed.data.admin_action === 'resolve') {
            await appkit.lakebase.query(
              `UPDATE public.support_cases SET status = 'resolved', updated_at = NOW() WHERE id = $1::uuid`,
              [caseId]
            );
          } else {
            await appkit.lakebase.query(
              `UPDATE public.support_cases
               SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
                   updated_at = NOW()
               WHERE id = $1::uuid`,
              [caseId]
            );
          }
        }

        const caseRow = await appkit.lakebase.query(`SELECT user_id FROM public.support_cases WHERE id = $1::uuid`, [
          caseId,
        ]);
        const userId = caseRow.rows[0]?.user_id as string | undefined;

        if (userId && parsed.data.admin_action === 'refund' && parsed.data.admin_amount_cents > 0) {
          const orderRow = await appkit.lakebase.query(
            `SELECT id::text AS id, total_in_cents FROM public.orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [userId]
          );
          const order = orderRow.rows[0];
          if (order) {
            const refundAmount = Math.min(parsed.data.admin_amount_cents, order.total_in_cents as number);
            await appkit.lakebase.query(
              `INSERT INTO public.refunds (user_id, order_id, support_case_id, amount_in_cents, reason)
               VALUES ($1, $2::uuid, $3::uuid, $4, $5)`,
              [userId, order.id, caseId, refundAmount, parsed.data.admin_response]
            );
          }
        } else if (userId && parsed.data.admin_action === 'credit' && parsed.data.admin_amount_cents > 0) {
          await appkit.lakebase.query(
            `INSERT INTO public.credits (user_id, support_case_id, amount_in_cents, reason)
             VALUES ($1, $2::uuid, $3, $4)`,
            [userId, caseId, parsed.data.admin_amount_cents, parsed.data.admin_response]
          );
        }

        res.status(201).json({
          ...decisionResult.rows[0],
          message,
        });
      } catch (err) {
        console.error('Failed to submit decision:', err);
        res.status(500).json({ error: 'Failed to submit decision' });
      }
    });

    app.get('/api/cases/:caseId/decisions', async (req, res) => {
      try {
        const caseId = req.params.caseId;
        const caseIdBytes = uuidToBytes(caseId);

        const result = await appkit.lakebase.query(
          `SELECT id, admin_action, admin_amount_cents, admin_response, created_at
           FROM support_console.admin_decisions
           WHERE case_id = $1
           ORDER BY created_at DESC`,
          [caseIdBytes]
        );

        res.json(result.rows);
      } catch (err) {
        console.error('Failed to get decisions:', err);
        res.status(500).json({ error: 'Failed to get decisions' });
      }
    });

    app.patch('/api/cases/:caseId/status', async (req, res) => {
      try {
        const caseId = req.params.caseId;
        const parsed = UpdateStatusBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
          return;
        }

        await appkit.lakebase.query(
          `UPDATE public.support_cases
           SET status = $1, updated_at = NOW()
           WHERE id = $2::uuid`,
          [parsed.data.status, caseId]
        );

        res.json({ status: parsed.data.status });
      } catch (err) {
        console.error('Failed to update case status:', err);
        res.status(500).json({ error: 'Failed to update case status' });
      }
    });
  });
}
