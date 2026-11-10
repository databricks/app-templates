SELECT
  suggested_action AS action,
  COUNT(*) AS count,
  ROUND(AVG(suggested_amount_cents), 0) AS avg_amount_cents
FROM REPLACE_ME.gold.support_agent_responses
GROUP BY suggested_action
ORDER BY count DESC;
