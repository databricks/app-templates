CREATE OR REFRESH MATERIALIZED VIEW gold.inventory_overview
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported')
AS
WITH sales_30d AS (
  SELECT
    store_id,
    product_id,
    SUM(units_sold) AS units_30d,
    SUM(units_sold) / 30.0 AS avg_daily_units
  FROM silver.daily_sales
  WHERE sale_date >= DATE_SUB(CURRENT_DATE(), 30)
  GROUP BY store_id, product_id
),
sales_7d AS (
  SELECT
    store_id,
    product_id,
    SUM(units_sold) AS units_7d
  FROM silver.daily_sales
  WHERE sale_date >= DATE_SUB(CURRENT_DATE(), 7)
  GROUP BY store_id, product_id
)
SELECT
  sl.store_id,
  st.name AS store_name,
  st.region,
  sl.product_id,
  p.sku,
  p.name AS product_name,
  p.category,
  p.unit_cost_cents,
  p.reorder_point,
  p.reorder_quantity,
  p.lead_time_days,
  sl.quantity_on_hand,
  sl.quantity_on_order,
  sl.last_counted_at,
  COALESCE(s30.avg_daily_units, 0) AS avg_daily_units_30d,
  COALESCE(s7.units_7d, 0) AS units_7d,
  COALESCE(s30.units_30d, 0) AS units_30d,
  CASE
    WHEN COALESCE(s30.avg_daily_units, 0) > 0
    THEN ROUND(sl.quantity_on_hand / s30.avg_daily_units, 1)
    ELSE NULL
  END AS days_of_supply,
  CASE
    WHEN sl.quantity_on_hand <= 0 THEN 'out_of_stock'
    WHEN sl.quantity_on_hand <= p.reorder_point * 0.5 THEN 'critical'
    WHEN sl.quantity_on_hand <= p.reorder_point THEN 'low'
    ELSE 'ok'
  END AS stock_status
FROM silver.stock_levels sl
JOIN silver.stores st ON sl.store_id = st.id
JOIN silver.products p ON sl.product_id = p.id
LEFT JOIN sales_30d s30 ON sl.store_id = s30.store_id AND sl.product_id = s30.product_id
LEFT JOIN sales_7d s7 ON sl.store_id = s7.store_id AND sl.product_id = s7.product_id;
