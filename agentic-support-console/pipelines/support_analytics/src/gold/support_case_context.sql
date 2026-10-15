CREATE OR REFRESH MATERIALIZED VIEW gold.support_case_context
TBLPROPERTIES ('delta.feature.timestampNtz' = 'supported')
AS
WITH message_stats AS (
  SELECT
    case_id,
    COUNT(*) AS message_count,
    MIN(created_at) AS first_message_at,
    MAX(created_at) AS last_message_at,
    MAX(CASE WHEN admin_id IS NOT NULL THEN 1 ELSE 0 END) AS has_admin_reply
  FROM silver.support_messages
  GROUP BY case_id
),
first_admin_reply AS (
  SELECT
    case_id,
    MIN(created_at) AS first_reply_at
  FROM silver.support_messages
  WHERE admin_id IS NOT NULL
  GROUP BY case_id
),
case_refunds AS (
  SELECT
    support_case_id,
    COALESCE(SUM(amount_in_cents), 0) AS linked_refund_cents
  FROM silver.refunds
  WHERE support_case_id IS NOT NULL
  GROUP BY support_case_id
),
case_credits AS (
  SELECT
    support_case_id,
    COALESCE(SUM(amount_in_cents), 0) AS linked_credit_cents
  FROM silver.credits
  WHERE support_case_id IS NOT NULL
  GROUP BY support_case_id
),
user_lifetime AS (
  SELECT
    user_id,
    SUM(total_in_cents) AS user_lifetime_spend_cents
  FROM silver.orders
  GROUP BY user_id
),
user_recent_cases AS (
  SELECT
    user_id,
    COUNT(*) AS user_cases_90d
  FROM silver.support_cases
  WHERE created_at >= DATE_ADD(CURRENT_DATE(), -90)
  GROUP BY user_id
)
SELECT
  sc.id AS case_id,
  sc.user_id,
  u.name AS user_name,
  u.email AS user_email,
  u.region AS user_region,
  sc.subject,
  sc.status,
  sc.created_at AS case_created_at,
  COALESCE(ms.message_count, 0) AS message_count,
  ms.first_message_at,
  ms.last_message_at,
  COALESCE(ms.has_admin_reply, 0) = 1 AS has_admin_reply,
  CAST(TIMESTAMPDIFF(MINUTE, sc.created_at, far.first_reply_at) AS BIGINT) AS first_response_minutes,
  COALESCE(cr.linked_refund_cents, 0) AS linked_refund_cents,
  COALESCE(cc.linked_credit_cents, 0) AS linked_credit_cents,
  COALESCE(ul.user_lifetime_spend_cents, 0) AS user_lifetime_spend_cents,
  COALESCE(urc.user_cases_90d, 0) AS user_cases_90d
FROM silver.support_cases sc
JOIN silver.users u ON sc.user_id = u.id
LEFT JOIN message_stats ms ON sc.id = ms.case_id
LEFT JOIN first_admin_reply far ON sc.id = far.case_id
LEFT JOIN case_refunds cr ON sc.id = cr.support_case_id
LEFT JOIN case_credits cc ON sc.id = cc.support_case_id
LEFT JOIN user_lifetime ul ON sc.user_id = ul.user_id
LEFT JOIN user_recent_cases urc ON sc.user_id = urc.user_id
