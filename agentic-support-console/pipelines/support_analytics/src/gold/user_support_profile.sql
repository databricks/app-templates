CREATE OR REFRESH MATERIALIZED VIEW gold.user_support_profile
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported')
AS
WITH order_stats AS (
  SELECT
    user_id,
    COUNT(*) AS lifetime_order_count,
    SUM(total_in_cents) AS lifetime_spend_cents,
    MAX(created_at) AS last_order_date,
    COUNT(CASE WHEN created_at >= DATE_ADD(CURRENT_DATE(), -90) THEN 1 END) AS total_orders_90d,
    COALESCE(SUM(CASE WHEN created_at >= DATE_ADD(CURRENT_DATE(), -90) THEN total_in_cents END), 0) AS total_spend_90d_cents
  FROM silver.orders
  GROUP BY user_id
),
case_stats AS (
  SELECT
    user_id,
    COUNT(*) AS support_cases_lifetime,
    MAX(created_at) AS last_support_case_date,
    COUNT(CASE WHEN created_at >= DATE_ADD(CURRENT_DATE(), -90) THEN 1 END) AS support_cases_90d
  FROM silver.support_cases
  GROUP BY user_id
),
refund_stats AS (
  SELECT
    user_id,
    COALESCE(SUM(CASE WHEN created_at >= DATE_ADD(CURRENT_DATE(), -90) THEN amount_in_cents END), 0) AS total_refunds_90d_cents
  FROM silver.refunds
  GROUP BY user_id
),
credit_stats AS (
  SELECT
    user_id,
    COALESCE(SUM(CASE WHEN created_at >= DATE_ADD(CURRENT_DATE(), -90) THEN amount_in_cents END), 0) AS total_credits_90d_cents
  FROM silver.credits
  GROUP BY user_id
)
SELECT
  u.id AS user_id,
  u.name,
  u.email,
  u.region,
  COALESCE(os.total_orders_90d, 0) AS total_orders_90d,
  COALESCE(os.total_spend_90d_cents, 0) AS total_spend_90d_cents,
  COALESCE(os.lifetime_order_count, 0) AS lifetime_order_count,
  COALESCE(os.lifetime_spend_cents, 0) AS lifetime_spend_cents,
  COALESCE(cs.support_cases_90d, 0) AS support_cases_90d,
  COALESCE(cs.support_cases_lifetime, 0) AS support_cases_lifetime,
  COALESCE(rs.total_refunds_90d_cents, 0) AS total_refunds_90d_cents,
  COALESCE(crs.total_credits_90d_cents, 0) AS total_credits_90d_cents,
  os.last_order_date,
  cs.last_support_case_date
FROM silver.users u
LEFT JOIN order_stats os ON u.id = os.user_id
LEFT JOIN case_stats cs ON u.id = cs.user_id
LEFT JOIN refund_stats rs ON u.id = rs.user_id
LEFT JOIN credit_stats crs ON u.id = crs.user_id
