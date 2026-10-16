CREATE OR REFRESH STREAMING TABLE silver.daily_sales
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported')
AS
SELECT
  store_id,
  product_id,
  DATE(sold_at) AS sale_date,
  SUM(quantity_sold) AS units_sold,
  SUM(quantity_sold * unit_price_cents) AS revenue_cents
FROM STREAM(lakebase.lb_sales_transactions_history)
WHERE _pg_change_type != 'delete'
GROUP BY store_id, product_id, DATE(sold_at);
