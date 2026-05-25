import { z } from "zod";
import type { Application } from "express";

interface AppKitWithLakebase {
  lakebase: {
    query(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const SUBSCRIPTIONS_EXISTS_SQL = `
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'saas_tracker' AND table_name = 'subscriptions'
`;

const SETUP_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS saas_tracker`;

const CREATE_SUBSCRIPTIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS saas_tracker.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    vendor TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    cost_cents INTEGER NOT NULL,
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',
    currency TEXT NOT NULL DEFAULT 'USD',
    owner_name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    department TEXT,
    license_count INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    start_date DATE NOT NULL,
    renewal_date DATE,
    cancellation_date DATE,
    url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const BILLING_CYCLES = ["monthly", "annual", "one_time"] as const;
const CATEGORIES = [
  "Engineering",
  "Design",
  "Marketing",
  "Sales",
  "HR",
  "Security",
  "Finance",
  "Operations",
  "Other",
] as const;
const STATUSES = [
  "active",
  "trial",
  "cancelled",
  "pending_cancellation",
] as const;

const CreateSubscriptionBody = z.object({
  name: z.string().min(1),
  vendor: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(CATEGORIES),
  cost_cents: z.number().int().min(0),
  billing_cycle: z.enum(BILLING_CYCLES),
  currency: z.string().default("USD"),
  owner_name: z.string().min(1),
  owner_email: z.string().email(),
  department: z.string().optional(),
  license_count: z.number().int().min(1).optional(),
  status: z.enum(STATUSES).default("active"),
  start_date: z.string().min(1),
  renewal_date: z.string().optional(),
  url: z.string().url().optional(),
  notes: z.string().optional(),
});

const UpdateSubscriptionBody = CreateSubscriptionBody.partial();

const UpdateStatusBody = z.object({
  status: z.enum(STATUSES),
});

export async function setupSaasRoutes(appkit: AppKitWithLakebase) {
  try {
    const { rows } = await appkit.lakebase.query(SUBSCRIPTIONS_EXISTS_SQL);
    if (rows.length > 0) {
      console.log("[saas] Table saas_tracker.subscriptions already exists");
    } else {
      await appkit.lakebase.query(SETUP_SCHEMA_SQL);
      await appkit.lakebase.query(CREATE_SUBSCRIPTIONS_TABLE_SQL);
      console.log("[saas] Created schema and table saas_tracker.subscriptions");
    }
  } catch (err) {
    console.warn("[saas] Database setup failed:", (err as Error).message);
  }

  appkit.server.extend((app) => {
    app.get("/api/subscriptions", async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            id::text,
            name, vendor, description, category,
            cost_cents, billing_cycle, currency,
            owner_name, owner_email, department,
            license_count, status,
            start_date, renewal_date, cancellation_date,
            url, notes, created_at, updated_at
          FROM saas_tracker.subscriptions
          ORDER BY
            CASE WHEN status = 'active' THEN 0
                 WHEN status = 'trial' THEN 1
                 WHEN status = 'pending_cancellation' THEN 2
                 ELSE 3
            END,
            renewal_date ASC NULLS LAST,
            name ASC
        `);
        res.json(result.rows);
      } catch (err) {
        console.error("Failed to list subscriptions:", err);
        res.status(500).json({ error: "Failed to list subscriptions" });
      }
    });

    app.get("/api/subscriptions/:id", async (req, res) => {
      try {
        const result = await appkit.lakebase.query(
          `
          SELECT
            id::text,
            name, vendor, description, category,
            cost_cents, billing_cycle, currency,
            owner_name, owner_email, department,
            license_count, status,
            start_date, renewal_date, cancellation_date,
            url, notes, created_at, updated_at
          FROM saas_tracker.subscriptions
          WHERE id = $1::uuid
        `,
          [req.params.id],
        );

        if (result.rows.length === 0) {
          res.status(404).json({ error: "Subscription not found" });
          return;
        }

        res.json(result.rows[0]);
      } catch (err) {
        console.error("Failed to get subscription:", err);
        res.status(500).json({ error: "Failed to get subscription" });
      }
    });

    app.post("/api/subscriptions", async (req, res) => {
      try {
        const parsed = CreateSubscriptionBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.issues,
          });
          return;
        }

        const d = parsed.data;
        const result = await appkit.lakebase.query(
          `INSERT INTO saas_tracker.subscriptions
            (name, vendor, description, category, cost_cents, billing_cycle, currency,
             owner_name, owner_email, department, license_count, status,
             start_date, renewal_date, url, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14::date, $15, $16)
           RETURNING id::text, name, vendor, status, created_at`,
          [
            d.name,
            d.vendor,
            d.description ?? null,
            d.category,
            d.cost_cents,
            d.billing_cycle,
            d.currency,
            d.owner_name,
            d.owner_email,
            d.department ?? null,
            d.license_count ?? null,
            d.status,
            d.start_date,
            d.renewal_date ?? null,
            d.url ?? null,
            d.notes ?? null,
          ],
        );

        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error("Failed to create subscription:", err);
        res.status(500).json({ error: "Failed to create subscription" });
      }
    });

    app.put("/api/subscriptions/:id", async (req, res) => {
      try {
        const parsed = UpdateSubscriptionBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.issues,
          });
          return;
        }

        const d = parsed.data;
        const setClauses: string[] = [];
        const values: unknown[] = [];
        let paramIdx = 1;

        const fields: Array<[string, unknown]> = [
          ["name", d.name],
          ["vendor", d.vendor],
          ["description", d.description],
          ["category", d.category],
          ["cost_cents", d.cost_cents],
          ["billing_cycle", d.billing_cycle],
          ["currency", d.currency],
          ["owner_name", d.owner_name],
          ["owner_email", d.owner_email],
          ["department", d.department],
          ["license_count", d.license_count],
          ["status", d.status],
          ["start_date", d.start_date],
          ["renewal_date", d.renewal_date],
          ["url", d.url],
          ["notes", d.notes],
        ];

        for (const [col, val] of fields) {
          if (val !== undefined) {
            const cast =
              col === "start_date" || col === "renewal_date" ? "::date" : "";
            setClauses.push(`${col} = $${paramIdx}${cast}`);
            values.push(val);
            paramIdx++;
          }
        }

        if (setClauses.length === 0) {
          res.status(400).json({ error: "No fields to update" });
          return;
        }

        setClauses.push("updated_at = NOW()");
        values.push(req.params.id);

        const result = await appkit.lakebase.query(
          `UPDATE saas_tracker.subscriptions
           SET ${setClauses.join(", ")}
           WHERE id = $${paramIdx}::uuid
           RETURNING id::text, name, vendor, status, updated_at`,
          values,
        );

        if (result.rows.length === 0) {
          res.status(404).json({ error: "Subscription not found" });
          return;
        }

        res.json(result.rows[0]);
      } catch (err) {
        console.error("Failed to update subscription:", err);
        res.status(500).json({ error: "Failed to update subscription" });
      }
    });

    app.patch("/api/subscriptions/:id/status", async (req, res) => {
      try {
        const parsed = UpdateStatusBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.issues,
          });
          return;
        }

        const cancellationClause =
          parsed.data.status === "cancelled"
            ? ", cancellation_date = CURRENT_DATE"
            : "";

        const result = await appkit.lakebase.query(
          `UPDATE saas_tracker.subscriptions
           SET status = $1${cancellationClause}, updated_at = NOW()
           WHERE id = $2::uuid
           RETURNING id::text, status`,
          [parsed.data.status, req.params.id],
        );

        if (result.rows.length === 0) {
          res.status(404).json({ error: "Subscription not found" });
          return;
        }

        res.json(result.rows[0]);
      } catch (err) {
        console.error("Failed to update status:", err);
        res.status(500).json({ error: "Failed to update status" });
      }
    });

    app.delete("/api/subscriptions/:id", async (req, res) => {
      try {
        const result = await appkit.lakebase.query(
          `DELETE FROM saas_tracker.subscriptions WHERE id = $1::uuid RETURNING id::text`,
          [req.params.id],
        );

        if (result.rows.length === 0) {
          res.status(404).json({ error: "Subscription not found" });
          return;
        }

        res.json({ deleted: true });
      } catch (err) {
        console.error("Failed to delete subscription:", err);
        res.status(500).json({ error: "Failed to delete subscription" });
      }
    });
  });
}
