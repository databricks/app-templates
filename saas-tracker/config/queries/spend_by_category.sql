SELECT
  category,
  COUNT(*) AS subscription_count,
  COALESCE(SUM(
    CASE
      WHEN billing_cycle = 'monthly' THEN cost_cents
      WHEN billing_cycle = 'annual' THEN ROUND(cost_cents / 12.0)
      ELSE 0
    END
  ), 0) AS monthly_spend_cents
FROM saas_tracker.app_data.subscriptions
WHERE status IN ('active', 'trial')
GROUP BY category
ORDER BY monthly_spend_cents DESC
