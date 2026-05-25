CREATE OR REFRESH MATERIALIZED VIEW gold.sales_velocity
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported')
AS
SELECT
  ds.store_id,
  st.name AS store_name,
  st.region,
  ds.product_id,
  p.sku,
  p.name AS product_name,
  p.category,
  SUM(CASE WHEN ds.sale_date >= DATE_SUB(CURRENT_DATE(), 7) THEN ds.units_sold ELSE 0 END) AS units_7d,
  SUM(CASE WHEN ds.sale_date >= DATE_SUB(CURRENT_DATE(), 30) THEN ds.units_sold ELSE 0 END) AS units_30d,
  SUM(CASE WHEN ds.sale_date >= DATE_SUB(CURRENT_DATE(), 60) THEN ds.units_sold ELSE 0 END) AS units_60d,
  SUM(CASE WHEN ds.sale_date >= DATE_SUB(CURRENT_DATE(), 90) THEN ds.units_sold ELSE 0 END) AS units_90d,
  ROUND(SUM(CASE WHEN ds.sale_date >= DATE_SUB(CURRENT_DATE(), 30) THEN ds.units_sold ELSE 0 END) / 30.0, 2) AS avg_daily_30d,
  ROUND(SUM(CASE WHEN ds.sale_date >= DATE_SUB(CURRENT_DATE(), 7) THEN ds.units_sold ELSE 0 END) / 7.0, 2) AS avg_daily_7d,
  SUM(CASE WHEN ds.sale_date >= DATE_SUB(CURRENT_DATE(), 30) THEN ds.revenue_cents ELSE 0 END) AS revenue_30d_cents,
  SUM(CASE WHEN ds.sale_date >= DATE_SUB(CURRENT_DATE(), 90) THEN ds.revenue_cents ELSE 0 END) AS revenue_90d_cents
FROM silver.daily_sales ds
JOIN silver.stores st ON ds.store_id = st.id
JOIN silver.products p ON ds.product_id = p.id
GROUP BY ds.store_id, st.name, st.region, ds.product_id, p.sku, p.name, p.category;
