CREATE OR REFRESH MATERIALIZED VIEW gold.daily_revenue
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported')
AS
WITH order_totals AS (
  SELECT
    DATE(o.created_at) AS order_date,
    COUNT(DISTINCT o.id) AS total_orders,
    SUM(o.total_in_cents) AS gross_revenue_cents
  FROM silver.orders o
  GROUP BY DATE(o.created_at)
),
items_sold AS (
  SELECT
    DATE(o.created_at) AS order_date,
    SUM(oi.quantity) AS items_sold
  FROM silver.order_items oi
  JOIN silver.orders o ON oi.order_id = o.id
  GROUP BY DATE(o.created_at)
),
refund_totals AS (
  SELECT
    DATE(o.created_at) AS order_date,
    COALESCE(SUM(r.amount_in_cents), 0) AS total_refunds_cents
  FROM silver.refunds r
  JOIN silver.orders o ON r.order_id = o.id
  WHERE r.status = 'approved'
  GROUP BY DATE(o.created_at)
),
credit_totals AS (
  SELECT
    DATE(c.created_at) AS credit_date,
    COALESCE(SUM(c.amount_in_cents), 0) AS total_credits_cents
  FROM silver.credits c
  GROUP BY DATE(c.created_at)
),
top_categories AS (
  SELECT
    order_date,
    category AS top_category
  FROM (
    SELECT
      DATE(o.created_at) AS order_date,
      mi.category,
      SUM(oi.price_in_cents * oi.quantity) AS category_revenue,
      ROW_NUMBER() OVER (PARTITION BY DATE(o.created_at) ORDER BY SUM(oi.price_in_cents * oi.quantity) DESC) AS rn
    FROM silver.order_items oi
    JOIN silver.orders o ON oi.order_id = o.id
    JOIN silver.menu_items mi ON oi.menu_item_id = mi.id
    GROUP BY DATE(o.created_at), mi.category
  )
  WHERE rn = 1
)
SELECT
  ot.order_date,
  ot.total_orders,
  ot.gross_revenue_cents,
  COALESCE(rt.total_refunds_cents, 0) AS total_refunds_cents,
  COALESCE(ct.total_credits_cents, 0) AS total_credits_cents,
  ot.gross_revenue_cents - COALESCE(rt.total_refunds_cents, 0) - COALESCE(ct.total_credits_cents, 0) AS net_revenue_cents,
  CAST(ot.gross_revenue_cents / ot.total_orders AS BIGINT) AS avg_order_value_cents,
  COALESCE(i.items_sold, 0) AS items_sold,
  tc.top_category
FROM order_totals ot
LEFT JOIN items_sold i ON ot.order_date = i.order_date
LEFT JOIN refund_totals rt ON ot.order_date = rt.order_date
LEFT JOIN credit_totals ct ON ot.order_date = ct.credit_date
LEFT JOIN top_categories tc ON ot.order_date = tc.order_date
