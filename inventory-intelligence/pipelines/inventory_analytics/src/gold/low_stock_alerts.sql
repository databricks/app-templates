CREATE OR REFRESH MATERIALIZED VIEW gold.low_stock_alerts
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported')
AS
SELECT
  store_id,
  store_name,
  region,
  product_id,
  sku,
  product_name,
  category,
  quantity_on_hand,
  quantity_on_order,
  reorder_point,
  reorder_quantity,
  lead_time_days,
  avg_daily_units_30d,
  days_of_supply,
  stock_status,
  CURRENT_TIMESTAMP() AS alerted_at
FROM gold.inventory_overview
WHERE stock_status IN ('critical', 'out_of_stock', 'low')
  AND quantity_on_order = 0;
