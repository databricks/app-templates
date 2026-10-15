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

// Returns empty array when sync tables don't exist yet (before the pipeline runs).
// Re-throws all other errors so the route handler can return 500.
function isTableMissingError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  return msg.includes("does not exist") || msg.includes("relation");
}

const SCHEMA_EXISTS_SQL = `
  SELECT 1 FROM information_schema.schemata
  WHERE schema_name = 'inventory'
`;

const ApproveReplenishmentBody = z.object({
  quantity_ordered: z.number().int().min(1),
  notes: z.string().optional(),
});

export const genieEnabled =
  !!process.env.DATABRICKS_GENIE_SPACE_ID &&
  process.env.DATABRICKS_GENIE_SPACE_ID !== "REPLACE_ME" &&
  process.env.DATABRICKS_GENIE_SPACE_ID.trim() !== "";

export async function setupInventoryRoutes(appkit: AppKitWithLakebase) {
  try {
    const { rows } = await appkit.lakebase.query(SCHEMA_EXISTS_SQL);
    if (rows.length > 0) {
      console.log("[inventory] Schema inventory already exists");
    } else {
      console.warn(
        "[inventory] Schema inventory not found — run seed/seed.ts first",
      );
    }
  } catch (err) {
    console.warn("[inventory] Schema check failed:", (err as Error).message);
  }

  appkit.server.extend((app) => {
    // GET /api/config — feature flags for the client
    app.get("/api/config", (_req, res) => {
      res.json({ genieEnabled });
    });

    // GET /api/overview — stock health summary across all stores and products
    app.get("/api/overview", async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            COUNT(*) FILTER (WHERE stock_status = 'ok') AS ok_count,
            COUNT(*) FILTER (WHERE stock_status = 'low') AS low_count,
            COUNT(*) FILTER (WHERE stock_status = 'critical') AS critical_count,
            COUNT(*) FILTER (WHERE stock_status = 'out_of_stock') AS out_of_stock_count,
            COUNT(DISTINCT store_id) AS store_count,
            COUNT(DISTINCT product_id) AS product_count,
            SUM(quantity_on_hand * unit_cost_cents) AS inventory_value_cents
          FROM gold.inventory_overview_sync
        `);
        res.json(result.rows[0] ?? {});
      } catch (err) {
        if (isTableMissingError(err)) {
          console.warn(
            "[inventory] gold sync tables not found — run the pipeline first",
          );
          res.json(null);
          return;
        }
        console.error("Failed to fetch overview:", err);
        res.status(500).json({ error: "Failed to fetch overview" });
      }
    });

    // GET /api/stores — list all stores with stock health summary
    app.get("/api/stores", async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            s.id AS store_id,
            s.name AS store_name,
            s.region,
            s.city,
            COUNT(io.product_id) AS total_skus,
            COUNT(io.product_id) FILTER (WHERE io.stock_status = 'ok') AS ok_count,
            COUNT(io.product_id) FILTER (WHERE io.stock_status = 'low') AS low_count,
            COUNT(io.product_id) FILTER (WHERE io.stock_status = 'critical') AS critical_count,
            COUNT(io.product_id) FILTER (WHERE io.stock_status = 'out_of_stock') AS out_of_stock_count
          FROM inventory.stores s
          LEFT JOIN gold.inventory_overview_sync io ON s.id = io.store_id
          GROUP BY s.id, s.name, s.region, s.city
          ORDER BY (COUNT(io.product_id) FILTER (WHERE io.stock_status IN ('critical', 'out_of_stock'))) DESC, s.name
        `);
        res.json(result.rows);
      } catch (err) {
        if (isTableMissingError(err)) {
          console.warn(
            "[inventory] gold sync tables not found — run the pipeline first",
          );
          res.json([]);
          return;
        }
        console.error("Failed to fetch stores:", err);
        res.status(500).json({ error: "Failed to fetch stores" });
      }
    });

    // GET /api/stores/:storeId/stock — stock levels for a specific store
    app.get("/api/stores/:storeId/stock", async (req, res) => {
      try {
        const result = await appkit.lakebase.query(
          `
          SELECT
            io.store_name,
            io.product_id,
            io.sku,
            io.product_name,
            io.category,
            io.unit_cost_cents,
            io.reorder_point,
            io.reorder_quantity,
            io.lead_time_days,
            io.quantity_on_hand,
            io.quantity_on_order,
            io.avg_daily_units_30d,
            io.units_7d,
            io.units_30d,
            io.days_of_supply,
            io.stock_status,
            io.last_counted_at,
            rr.forecast_30d_units,
            rr.recommended_order_qty,
            rr.confidence,
            rr.model_used
          FROM gold.inventory_overview_sync io
          LEFT JOIN gold.replenishment_recommendations_sync rr
            ON io.store_id = rr.store_id AND io.product_id = rr.product_id
          WHERE io.store_id = $1
          ORDER BY
            CASE io.stock_status
              WHEN 'out_of_stock' THEN 0
              WHEN 'critical' THEN 1
              WHEN 'low' THEN 2
              ELSE 3
            END,
            io.days_of_supply ASC NULLS LAST
        `,
          [req.params.storeId],
        );
        res.json(result.rows);
      } catch (err) {
        if (isTableMissingError(err)) {
          res.json([]);
          return;
        }
        console.error("Failed to fetch store stock:", err);
        res.status(500).json({ error: "Failed to fetch store stock" });
      }
    });

    // GET /api/alerts — products needing replenishment (no order placed)
    app.get("/api/alerts", async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            la.store_id,
            la.store_name,
            la.region,
            la.product_id,
            la.sku,
            la.product_name,
            la.category,
            la.quantity_on_hand,
            la.quantity_on_order,
            la.reorder_point,
            la.reorder_quantity,
            la.avg_daily_units_30d,
            la.days_of_supply,
            la.stock_status,
            rr.forecast_30d_units,
            rr.recommended_order_qty,
            rr.confidence,
            rr.model_used
          FROM gold.low_stock_alerts_sync la
          LEFT JOIN gold.replenishment_recommendations_sync rr
            ON la.store_id = rr.store_id AND la.product_id = rr.product_id
          ORDER BY
            CASE la.stock_status
              WHEN 'out_of_stock' THEN 0
              WHEN 'critical' THEN 1
              ELSE 2
            END,
            la.days_of_supply ASC NULLS LAST
          LIMIT 500
        `);
        res.json(result.rows);
      } catch (err) {
        if (isTableMissingError(err)) {
          res.json([]);
          return;
        }
        console.error("Failed to fetch alerts:", err);
        res.status(500).json({ error: "Failed to fetch alerts" });
      }
    });

    // GET /api/replenishment — all pending AI-generated recommendations
    app.get("/api/replenishment", async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            rr.store_id,
            s.name AS store_name,
            s.region,
            rr.product_id,
            p.sku,
            p.name AS product_name,
            p.category,
            p.lead_time_days,
            rr.forecast_30d_units,
            rr.recommended_order_qty,
            rr.confidence,
            rr.model_used,
            rr.generated_at,
            COALESCE(sl.quantity_on_hand, 0) AS quantity_on_hand,
            COALESCE(sl.quantity_on_order, 0) AS quantity_on_order,
            ro.id AS open_order_id,
            ro.status AS open_order_status,
            ro.quantity_ordered AS open_order_qty,
            ro.expected_delivery_at
          FROM gold.replenishment_recommendations_sync rr
          JOIN inventory.stores s ON rr.store_id = s.id
          JOIN inventory.products p ON rr.product_id = p.id
          LEFT JOIN inventory.stock_levels sl
            ON rr.store_id = sl.store_id AND rr.product_id = sl.product_id
          LEFT JOIN LATERAL (
            SELECT id, status, quantity_ordered, expected_delivery_at
            FROM inventory.replenishment_orders
            WHERE store_id = rr.store_id
              AND product_id = rr.product_id
              AND status NOT IN ('received', 'cancelled')
            ORDER BY ordered_at DESC
            LIMIT 1
          ) ro ON true
          WHERE COALESCE(rr.recommended_order_qty, 0) > 0
          ORDER BY
            CASE rr.confidence
              WHEN 'high' THEN 0
              WHEN 'medium' THEN 1
              ELSE 2
            END,
            rr.recommended_order_qty DESC
        `);
        res.json(result.rows);
      } catch (err) {
        if (isTableMissingError(err)) {
          res.json([]);
          return;
        }
        console.error("Failed to fetch replenishment recommendations:", err);
        res
          .status(500)
          .json({ error: "Failed to fetch replenishment recommendations" });
      }
    });

    // POST /api/replenishment/:storeId/:productId/approve — create replenishment order
    app.post(
      "/api/replenishment/:storeId/:productId/approve",
      async (req, res) => {
        try {
          const { storeId, productId } = req.params;

          const parsed = ApproveReplenishmentBody.safeParse(req.body);
          if (!parsed.success) {
            res.status(400).json({
              error: "Invalid request body",
              details: parsed.error.issues,
            });
            return;
          }

          // Verify store and product exist
          const storeCheck = await appkit.lakebase.query(
            `SELECT id FROM inventory.stores WHERE id = $1`,
            [storeId],
          );
          if (storeCheck.rows.length === 0) {
            res.status(404).json({ error: "Store not found" });
            return;
          }

          const productCheck = await appkit.lakebase.query(
            `SELECT id, lead_time_days FROM inventory.products WHERE id = $1`,
            [productId],
          );
          if (productCheck.rows.length === 0) {
            res.status(404).json({ error: "Product not found" });
            return;
          }

          const leadTimeDays = productCheck.rows[0].lead_time_days as number;
          const expectedDelivery = new Date();
          expectedDelivery.setDate(expectedDelivery.getDate() + leadTimeDays);

          // Atomic: insert the order and update on-order quantity in one CTE
          const result = await appkit.lakebase.query(
            `WITH inserted AS (
               INSERT INTO inventory.replenishment_orders
                 (store_id, product_id, quantity_ordered, status, ordered_at, expected_delivery_at, notes)
               VALUES ($1, $2, $3, 'pending', NOW(), $4, $5)
               RETURNING id::text, store_id, product_id, quantity_ordered, status, ordered_at, expected_delivery_at
             ), _stock AS (
               UPDATE inventory.stock_levels
               SET quantity_on_order = quantity_on_order + $3, last_counted_at = NOW()
               WHERE store_id = $1 AND product_id = $2
             )
             SELECT * FROM inserted`,
            [
              storeId,
              productId,
              parsed.data.quantity_ordered,
              expectedDelivery.toISOString(),
              parsed.data.notes ?? null,
            ],
          );

          res.status(201).json(result.rows[0]);
        } catch (err) {
          console.error("Failed to approve replenishment:", err);
          res.status(500).json({ error: "Failed to approve replenishment" });
        }
      },
    );

    // PATCH /api/replenishment/:orderId/status — update order status
    app.patch("/api/replenishment/:orderId/status", async (req, res) => {
      try {
        const UpdateStatusBody = z.object({
          status: z.enum([
            "pending",
            "ordered",
            "shipped",
            "received",
            "cancelled",
          ]),
        });

        const parsed = UpdateStatusBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.issues,
          });
          return;
        }

        const orderResult = await appkit.lakebase.query(
          `UPDATE inventory.replenishment_orders
           SET status = $1
           WHERE id = $2::uuid
           RETURNING id::text, store_id, product_id, quantity_ordered, status`,
          [parsed.data.status, req.params.orderId],
        );

        if (orderResult.rows.length === 0) {
          res.status(404).json({ error: "Order not found" });
          return;
        }

        // When order is received, add to stock and zero out on_order
        if (parsed.data.status === "received") {
          const { store_id, product_id, quantity_ordered } =
            orderResult.rows[0];
          await appkit.lakebase.query(
            `UPDATE inventory.stock_levels
             SET quantity_on_hand = quantity_on_hand + $1,
                 quantity_on_order = GREATEST(0, quantity_on_order - $1),
                 last_counted_at = NOW()
             WHERE store_id = $2 AND product_id = $3`,
            [quantity_ordered, store_id, product_id],
          );
        }

        res.json(orderResult.rows[0]);
      } catch (err) {
        console.error("Failed to update order status:", err);
        res.status(500).json({ error: "Failed to update order status" });
      }
    });

    // GET /api/orders — recent replenishment orders
    app.get("/api/orders", async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            ro.id::text AS id,
            ro.store_id,
            s.name AS store_name,
            ro.product_id,
            p.sku,
            p.name AS product_name,
            p.category,
            ro.quantity_ordered,
            ro.status,
            ro.ordered_at,
            ro.expected_delivery_at,
            ro.notes
          FROM inventory.replenishment_orders ro
          JOIN inventory.stores s ON ro.store_id = s.id
          JOIN inventory.products p ON ro.product_id = p.id
          ORDER BY ro.ordered_at DESC
          LIMIT 100
        `);
        res.json(result.rows);
      } catch (err) {
        if (isTableMissingError(err)) {
          res.json([]);
          return;
        }
        console.error("Failed to fetch orders:", err);
        res.status(500).json({ error: "Failed to fetch orders" });
      }
    });
  });
}
