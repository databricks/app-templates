import { z } from 'zod';
import type { Application, Request } from 'express';
import { sql } from '@databricks/appkit';

/**
 * Every SQL statement the app runs.
 *
 * Deliberately server routes rather than `config/queries/*.sql` files:
 *
 *  - AppKit does not interpolate environment variables into query files
 *    (`processQueryParams` special-cases only `:workspaceId`), and a table name
 *    cannot be a bound parameter, so a query file would have to hardcode the
 *    table. Here it comes from one env var.
 *  - Any file in `config/queries` is callable from the browser with arbitrary
 *    parameters, which would make the approver column of an audit trail
 *    forgeable. The approver is read from the request headers instead.
 *  - Keeping SQL out of query files also avoids typegen, which runs `DESCRIBE`
 *    as the app's service principal even for an OBO app and fails the build on
 *    a cold cache if that principal cannot read the table.
 *
 * Reads and writes both run as the signed-in user via `asUser(req)`, so Unity
 * Catalog applies the reviewer's own grants.
 */

/** Table names are identifiers, so they cannot be bound as parameters. */
const QUALIFIED_NAME = /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;

/** One env var names the input; the two outputs follow by convention. */
function tables() {
  const input = process.env.INPUT_TABLE;
  if (!input || !QUALIFIED_NAME.test(input)) return null;
  return { input, log: `${input}_approved_log`, approved: `${input}_approved` };
}

const ApproveBody = z.object({
  id: z.string().min(1),
  /** Only the values the approver changed, keyed by the path the walker emits. */
  edits: z.record(z.string(), z.string()),
});

/**
 * Turn the two first-run failures into something a user can act on. Both are
 * common: `INPUT_TABLE` still holds the placeholder from app.yaml, or the input
 * table exists but `npm run setup` has not created the two output objects.
 */
function explain(err: unknown, t: { input: string; log: string; approved: string }): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/TABLE_OR_VIEW_NOT_FOUND|cannot be found|does not exist/i.test(message)) {
    if (message.includes(`${t.input}_approved`)) {
      return `${t.approved} does not exist. Run \`npm run setup\` to create the approval log and view for ${t.input}.`;
    }
    return `${t.input} does not exist. Point INPUT_TABLE at a table with an id column and a VARIANT response column.`;
  }
  if (/PERMISSION_DENIED|does not have permission|INSUFFICIENT_PERMISSIONS/i.test(message)) {
    return `You do not have access to ${t.input}. Queries run as the signed-in user, so Unity Catalog grants apply to you, not to the app.`;
  }
  return message;
}

interface AppKitWithAnalytics {
  analytics: { query(statement: string, parameters?: Record<string, unknown>): Promise<unknown> };
  asUser(req: Request): AppKitWithAnalytics;
  server: { extend(fn: (app: Application) => void): void };
}

/**
 * `to_json(...)` returns a STRING, but AppKit hands it over already parsed in
 * some cases, so accept either rather than assuming one. Getting this wrong is
 * silent: the value is present, just not the type you asserted.
 */
function asObject(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  }
  return v;
}

/** Rows come back shaped by the SQL driver; normalise to plain objects. */
function rows(result: unknown): Record<string, unknown>[] {
  const r = result as { result?: { data_array?: unknown[][] }; data?: unknown[] } | unknown[];
  if (Array.isArray(r)) return r as Record<string, unknown>[];
  if (Array.isArray((r as { data?: unknown[] }).data)) {
    return (r as { data: Record<string, unknown>[] }).data;
  }
  return [];
}

/**
 * Attribution is never a knob. A deployed app always has the header; local
 * development has no proxy, so it falls back to a marked identity rather than
 * silently recording an empty approver.
 */
function approverOf(req: Request): string | null {
  const header = req.header('X-Forwarded-Email') ?? req.header('X-Forwarded-Preferred-Username');
  if (header) return header;
  return process.env.NODE_ENV === 'development' ? 'local-dev@localhost' : null;
}

/**
 * Set a value inside a copy of the model's response, at a path the walker
 * produced ("response.line_items[0].amount" or "document.elements[3].content").
 * The surrounding structure, including confidence scores and citations, is left
 * exactly as the model wrote it, which is what keeps `approved_response` in the
 * same schema as `response`.
 */
function setAtPath(root: unknown, path: string, value: string): void {
  const steps = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let node = root as Record<string, unknown> | unknown[];
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    const next = Array.isArray(node)
      ? (node)[Number(step)]
      : (node)[step];
    if (next === undefined || next === null || typeof next !== 'object') return;
    node = next as Record<string, unknown> | unknown[];
  }
  const last = steps[steps.length - 1];
  const target = Array.isArray(node)
    ? (node)[Number(last)]
    : (node)[last];

  // A wrapped leaf keeps its wrapper: only `value` changes.
  if (target && typeof target === 'object' && 'value' in (target as Record<string, unknown>)) {
    (target as Record<string, unknown>).value = value;
  } else if (target && typeof target === 'object' && 'content' in (target as Record<string, unknown>)) {
    (target as Record<string, unknown>).content = value;
  } else if (Array.isArray(node)) {
    (node)[Number(last)] = value;
  } else {
    (node)[last] = value;
  }
}

export function setupReviewRoutes(appkit: AppKitWithAnalytics) {
  appkit.server.extend((app) => {
    /** Review queue: every document, pending first. */
    app.get('/api/documents', async (req, res) => {
      const t = tables();
      if (!t) {
        res.status(500).json({ error: 'INPUT_TABLE must be set to a catalog.schema.table name' });
        return;
      }
      try {
        // The view has one row per input document, so no join is needed here.
        const result = await appkit.asUser(req).analytics.query(`
          SELECT id,
                 approval_count > 0 AS approved,
                 CAST(latest_approved_at AS STRING) AS approved_at,
                 approval_count
          FROM ${t.approved}
          ORDER BY approved ASC, id ASC
        `);
        res.json(rows(result));
      } catch (err) {
        console.error('Failed to list documents:', err);
        res.status(500).json({ error: explain(err, t) });
      }
    });

    /**
     * One document, as raw JSON. The client walks the shape, which is why this
     * works for any AI function output without the server knowing the schema.
     */
    app.get('/api/document', async (req, res) => {
      const t = tables();
      if (!t) {
        res.status(500).json({ error: 'INPUT_TABLE must be set to a catalog.schema.table name' });
        return;
      }
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      try {
        const result = await appkit.asUser(req).analytics.query(
          `
          SELECT to_json(v.response)          AS response,
                 to_json(v.latest_approved_response) AS approved_response,
                 CAST(v.latest_approved_at AS STRING)   AS approved_at,
                 v.latest_approver                      AS approver,
                 v.approval_count
          FROM ${t.approved} v
          WHERE v.id = :id
        `,
          { id: sql.string(id) },
        );
        const row = rows(result)[0];
        if (!row) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        res.json(row);
      } catch (err) {
        console.error('Failed to load document:', err);
        res.status(500).json({ error: explain(err, t) });
      }
    });

    /**
     * Approve: overlay the approver's edits onto the model's response and append
     * the whole thing to the log. The client sends only what it changed, so it
     * can neither invent metadata nor name the approver.
     */
    app.post('/api/approve', async (req, res) => {
      const t = tables();
      if (!t) {
        res.status(500).json({ error: 'INPUT_TABLE must be set to a catalog.schema.table name' });
        return;
      }
      const approver = approverOf(req);
      if (!approver) {
        res.status(401).json({ error: 'No authenticated user on the request' });
        return;
      }
      const parsed = ApproveBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid approval payload' });
        return;
      }
      const { id: documentId, edits } = parsed.data;

      try {
        const user = appkit.asUser(req);
        // Start from the latest approved document if there is one, so a second
        // approval builds on the first rather than reverting it.
        const current = await user.analytics.query(
          `
          SELECT coalesce(to_json(latest_approved_response), to_json(response)) AS base
          FROM ${t.approved}
          WHERE id = :id
        `,
          { id: sql.string(documentId) },
        );
        const approved = asObject(rows(current)[0]?.base);
        if (approved === null || typeof approved !== 'object') {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        for (const [path, value] of Object.entries(edits)) setAtPath(approved, path, value);

        await user.analytics.query(
          `
          INSERT INTO ${t.log} (id, approver, approved_at, approved_response)
          SELECT :id, :approver, current_timestamp(), parse_json(:approved_response)
        `,
          {
            id: sql.string(documentId),
            approver: sql.string(approver),
            approved_response: sql.string(JSON.stringify(approved)),
          },
        );
        res.json({ id: documentId, approver, changed: Object.keys(edits).length });
      } catch (err) {
        console.error('Failed to approve:', err);
        res.status(500).json({ error: explain(err, t) });
      }
    });
  });
}
