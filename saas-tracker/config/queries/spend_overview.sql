SELECT
  SUM(CASE WHEN status IN ('active', 'trial') THEN 1 ELSE 0 END) AS active_count,
  SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
  COALESCE(SUM(
    CASE
      WHEN status IN ('active', 'trial') AND billing_cycle = 'monthly' THEN cost_cents
      WHEN status IN ('active', 'trial') AND billing_cycle = 'annual' THEN ROUND(cost_cents / 12.0)
      ELSE 0
    END
  ), 0) AS monthly_spend_cents,
  COALESCE(SUM(
    CASE
      WHEN status IN ('active', 'trial') AND billing_cycle = 'annual' THEN cost_cents
      WHEN status IN ('active', 'trial') AND billing_cycle = 'monthly' THEN cost_cents * 12
      ELSE 0
    END
  ), 0) AS annual_spend_cents,
  SUM(CASE
    WHEN status IN ('active', 'trial')
      AND renewal_date IS NOT NULL
      AND renewal_date <= DATE_ADD(CURRENT_DATE(), 30)
      AND renewal_date >= CURRENT_DATE()
    THEN 1 ELSE 0
  END) AS renewals_next_30d
FROM saas_tracker.app_data.subscriptions
