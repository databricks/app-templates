SELECT
  case_date,
  total_cases,
  open_cases,
  resolved_cases,
  ROUND(avg_messages_per_case, 1) AS avg_messages_per_case,
  ROUND(avg_first_response_minutes, 0) AS avg_first_response_minutes,
  cases_with_refund,
  cases_with_credit,
  total_refund_cents,
  total_credit_cents
FROM REPLACE_ME.gold.support_overview
ORDER BY case_date DESC;
