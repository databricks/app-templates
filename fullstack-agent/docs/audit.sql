-- Read-only audit queries over the audit table and the query history, access audit and Unity Gateway usage system tables.
SELECT occurred_at, action, actor, target_ids, amount, outcome, reason
FROM IDENTIFIER(:catalog || '.' || :project || '_ops.action_audit')
ORDER BY occurred_at DESC;

SELECT start_time, executed_by, executed_as, client_application, statement_type, execution_status, error_message, query_tags
FROM system.query.history
WHERE compute.warehouse_id = :warehouse_id
  AND start_time >= current_date()
  AND executed_by IN (:user_one, :user_two)
  AND statement_type IN ('CALL', 'UPDATE', 'INSERT', 'DELETE', 'MERGE')
ORDER BY start_time DESC;

SELECT
  identity_metadata.run_by,
  identity_metadata.run_as,
  identity_metadata.acting_resource_display_name AS acting_app,
  identity_metadata.acting_resource_type,
  service_name,
  action_name,
  count(*) AS events,
  max(event_time) AS last_event
FROM system.access.audit
WHERE workspace_id = :workspace_id
  AND event_date >= current_date()
  AND identity_metadata.acting_resource_display_name = :agent_app_name
GROUP BY ALL
ORDER BY run_by, events DESC;

SELECT
  requester,
  service_name,
  count(*) AS calls,
  round(avg(latency_ms)) AS avg_latency_ms,
  max(event_time) AS last_call
FROM system.ai_gateway.usage
WHERE event_time >= current_date()
  AND requester IN (:user_one, :user_two)
  AND service_name = :catalog || '.' || :project || '_ops.sonnet_llm'
GROUP BY ALL
ORDER BY requester, service_name;

SELECT
  CAST(event_time AS DATE) AS day,
  requester,
  destination_model,
  count(*) AS calls,
  sum(input_tokens) AS input_tokens,
  sum(output_tokens) AS output_tokens,
  sum(token_details.cache_read_input_tokens) AS cache_read_tokens,
  sum(token_details.cache_creation_input_tokens) AS cache_write_tokens
FROM system.ai_gateway.usage
WHERE event_time >= CAST(:start_date AS DATE)
  AND event_time < CAST(:end_date AS DATE) + INTERVAL 1 DAY
  AND service_name = :catalog || '.' || :project || '_ops.sonnet_llm'
GROUP BY ALL
ORDER BY day, requester, destination_model;
