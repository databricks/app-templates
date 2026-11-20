import { z } from 'zod';
import type { Application, Request } from 'express';
import { AuthenticationError, sql } from '@databricks/appkit';
import { applyEdit, MAX_EDITS, MAX_PATH_LENGTH, MAX_VALUE_LENGTH } from '../apply-edit';

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

/**
 * The queue is a flat list, not a paginated one, so it is bounded here rather
 * than left to scan the whole table. For a larger corpus, point INPUT_TABLE at
 * a view that filters to the slice a reviewer should work through.
 */
const QUEUE_LIMIT = 1000;

/** One env var names the input; the two outputs follow by convention. */
function tables() {
  const input = process.env.INPUT_TABLE;
  if (!input || !QUALIFIED_NAME.test(input)) return null;
  return { input, log: `${input}_approved_log`, approved: `${input}_approved` };
}

const ApproveBody = z.object({
  id: z.string().min(1).max(MAX_PATH_LENGTH),
  /**
   * Only the values the approver changed, keyed by the path the walker emits.
   * Bounded here and then checked against the server's own copy of the
   * document in `applyEdit`, because the client is the only source of a path.
   */
  edits: z
    .record(z.string().max(MAX_PATH_LENGTH), z.string().max(MAX_VALUE_LENGTH))
    .refine((e) => Object.keys(e).length <= MAX_EDITS, {
      message: `At most ${MAX_EDITS} edits per approval`,
    }),
});

/**
 * Turn the two first-run failures into something a user can act on. Both are
 * common: `INPUT_TABLE` still holds the placeholder from app.yaml, or the input
 * table exists but `npm run setup` has not created the two output objects.
 */
function explain(err: unknown, t: { input: string; log: string; approved: string }): { status: number; error: string } {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof AuthenticationError || /x-forwarded-access-token|missing token/i.test(message)) {
    return {
      status: 401,
      error: 'Your session has no forwarded user token. Reload the app to sign in again.',
    };
  }

  if (/TABLE_OR_VIEW_NOT_FOUND|cannot be found|does not exist/i.test(message)) {
    // Name the object the error is actually about: the log and the view are
    // created together by setup, the input table is the user's own.
    if (message.includes(t.log)) {
      return {
        status: 500,
        error: `${t.log} does not exist. Run \`npm run setup\` to create the approval log and view for ${t.input}.`,
      };
    }
    if (message.includes(t.approved)) {
      return {
        status: 500,
        error: `${t.approved} does not exist. Run \`npm run setup\` to create the approval log and view for ${t.input}.`,
      };
    }
    return {
      status: 500,
      error: `${t.input} does not exist. Point INPUT_TABLE at a table with an id column and a VARIANT response column.`,
    };
  }

  if (/PERMISSION_DENIED|does not have permission|INSUFFICIENT_PERMISSIONS/i.test(message)) {
    // Which grant is missing depends on the statement that failed, so name the
    // object in the error rather than always blaming INPUT_TABLE.
    const object = [t.log, t.approved, t.input].find((name) => message.includes(name));
    const needed =
      object === t.log
        ? `MODIFY and SELECT on ${t.log}`
        : object
          ? `SELECT on ${object}`
          : `CAN USE on the SQL warehouse, and SELECT on ${t.input}`;
    return {
      status: 403,
      error: `You are missing ${needed}. Queries run as the signed-in user, so Unity Catalog grants apply to you, not to the app.`,
    };
  }

  // Anything else: the detail is in the server log, not in the response.
  return { status: 500, error: 'The query failed. Check the app logs for the details.' };
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
          LIMIT ${QUEUE_LIMIT}
        `);
        res.json(rows(result));
      } catch (err) {
        console.error('Failed to list documents:', err);
        const { status, error } = explain(err, t);
        res.status(status).json({ error });
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
          { id: sql.string(id) }
        );
        const row = rows(result)[0];
        if (!row) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        res.json(row);
      } catch (err) {
        console.error('Failed to load document:', err);
        const { status, error } = explain(err, t);
        res.status(status).json({ error });
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
        // Every approval is an independent review of the model's own output, so
        // the base is always `response`, never a previous approval. Two
        // reviewers of one document produce two comparable opinions rather than
        // one building on the other; the log keeps both.
        const current = await user.analytics.query(
          `
          SELECT to_json(response) AS base
          FROM ${t.approved}
          WHERE id = :id
        `,
          { id: sql.string(documentId) }
        );
        const approved = asObject(rows(current)[0]?.base);
        if (approved === null || typeof approved !== 'object') {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        for (const [path, value] of Object.entries(edits)) {
          if (!applyEdit(approved, path, value)) {
            res.status(400).json({
              error: `"${path}" is not an editable value in this document`,
            });
            return;
          }
        }

        await user.analytics.query(
          `
          INSERT INTO ${t.log} (id, approver, approved_at, approved_response)
          SELECT :id, :approver, current_timestamp(), parse_json(:approved_response)
        `,
          {
            id: sql.string(documentId),
            approver: sql.string(approver),
            approved_response: sql.string(JSON.stringify(approved)),
          }
        );
        res.json({ id: documentId, approver, changed: Object.keys(edits).length });
      } catch (err) {
        console.error('Failed to approve:', err);
        const { status, error } = explain(err, t);
        res.status(status).json({ error });
      }
    });
  });
}
