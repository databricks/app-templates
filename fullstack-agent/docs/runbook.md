# Runbook

This page covers how to watch, alert on and recover the deployed agent app, `agent-bricks-<project>`. [deployment.md](deployment.md) covers setup, [development.md](development.md) covers tests, and [evaluation.md](evaluation.md) covers evals.

Run commands from the repo root after `export DATABRICKS_CONFIG_PROFILE=<profile>`. For a target other than the default, pass `-t <target>` to `databricks bundle` and the target as the scripts' first argument.

## Monitoring

### Logs

On Apps, `app/runtime/telemetry.py` exports the agent's log records within seconds to `<catalog>.<project>_ops.agent_app_otel_logs`: the level in `severity_text`, the message in `body`, the fields in `attributes`, the logger in `instrumentation_scope.name`. Apps keeps no logs after its compute stops, so this table is the record.

The app logs these records, listed with their fields:

- ERROR: `Read failed` (`tool` or `route`, `target`, `code` `QUERY_FAILED` or `QUERY_TIMEOUT`, `state`); `Procedure statement passed the call deadline` (`statement_id`, `state`); `Confirmation outcome unknown` (`action`, `status` `OUTCOME_UNKNOWN`, `error` as the exception's type, `duration_ms`); `Model call failed` with `status` `FAILED`; `Activity write failed` (`run_id`, `rows`, `code`); `Feedback not logged` (`code`).
- WARNING: `Read refused for lack of permission` (as `Read failed`, `code` `PERMISSION_DENIED`); `Procedure call refused before it ran` (`procedure`); `Procedure refused for lack of permission` (`procedure`, `statement_id`); `Model call failed` with `status` `RATE_LIMITED`, `NOT_ALLOWED` or `POLICY_BLOCKED`; `Run reached its turn limit` (`status` `TURNS_EXCEEDED`); `Display refused` and `Calculation refused` (`tool`, `status` `NOT_GROUNDED` or `NOT_CALCULATED`, `values`).
- INFO: `Procedure statement ended` (`procedure`, `statement_id`, `state`, `duration_ms`); `Confirmation ended` (`action`, `status`, `reference`, `duration_ms`); `Feedback logged` (`helpful`); `Replaced the last turn` and `Conversation compacted` (item counts).

No record holds row data, error text, arguments or identities, but the platform's rows in the table name users, so only the readers in [security.md](security.md#trace-telemetry-and-inference-data) may read it. This query reads the last hour's warnings and errors:

```sql
SELECT time, severity_text, body::string, attributes, resource.attributes:['service.version']::string AS version
FROM <catalog>.<project>_ops.agent_app_otel_logs
WHERE severity_text IN ('WARN', 'ERROR') AND time > current_timestamp() - INTERVAL 1 HOUR
ORDER BY time DESC
```

### Traces

The trace experiment `<root_path>/<project>-traces` stores traces in Unity Catalog tables in `<project>_ops`. Query the view `agent_traces_trace_unified`; the raw `agent_traces_otel_*` tables can change shape. `MLFLOW_ENABLE_OTLP_EXPORTER=false` in `app/app.yaml` keeps traces out of the telemetry tables. Each question, confirmation and `/compact` is its own trace, with the root span `question`, `confirm` or `compact`. A refused question ends OK with `app.status` `POLICY_BLOCKED`. Each trace carries `mlflow.trace.session`, `mlflow.trace.user`, `app.version`, `app.environment` and `mlflow.modelId`. Read a conversation by its session ID:

```sql
SELECT request_time, tags['mlflow.traceName'] AS kind, state, execution_duration_ms
FROM <catalog>.<project>_ops.agent_traces_trace_unified
WHERE trace_metadata:['mlflow.trace.session']::string = '<session ID>'
ORDER BY request_time
```

The Agent Bricks CLI also lists them: `agentbricks -p <profile> tracing list --experiment-name "$(databricks bundle validate -o json | jq -r .resources.experiments.agent_traces.name)" --warehouse <warehouse ID>`. In `demo` and `staging`, most traces come from the suites and evals, so the SLOs and production scorers mostly measure test traffic.

### Versions

`mlflow.modelId` names the LoggedModel `<project>-<12-character commit>` that `scripts/deploy_agent.sh` creates per deployed commit. The experiment's Agent versions tab lists them ([deployment.md](deployment.md#agent-app)). The app shows in Unity Gateway's Agents list because its name starts with `agent-`.

### SLOs

The SLOs cover a rolling 30 days and come from the trace view:

- Answer latency: 95% of answers within 20 s, as the p95 of `execution_duration_ms` for traces whose `mlflow.traceName` isn't `confirm`.
- Error rate: 99% of runs end without error, as the share of traces with `state = 'ERROR'`.

### Dashboard

`resources/observability/operations.dashboard.yml` deploys `<display_name> assistant operations`: runs, failed runs and rate-limited model calls over 7 days, then hourly runs, p95 answer time, warnings and errors, and refused model calls. Viewers need `SELECT` on the trace view and the logs table (the ops group has both) and on `system.ai_gateway.usage`, because it queries with their credentials. After a table prefix change, update `operations.lvdash.json` beside it.

## Alerts

The bundle declares nine SQL alerts, one per `resources/observability/*.alert.yml`, each named `<display_name>: <check>`. They run on `warehouse_id` as the deployer, who needs `SELECT` on the system tables they read, and notify `alert_subscriptions` (empty by default) when they fire and recover. The system tables arrive late, so their alerts look back further.

| Alert | Fires when | Do |
| :--- | :--- | :--- |
| `failed runs` (`run_errors`) | Over 5% of traces in the last hour ended in error; checked every 15 minutes | Open the failed traces; ERROR records name the boundary |
| `slow answers` (`answer_latency`) | p95 answer time over 20 s in the last hour, confirmations left out; every 15 minutes | Check the warehouse alert, model latency in `system.ai_gateway.usage` and [Capacity](#capacity) |
| `failed reads` (`read_failures`) | More than 2 records with `code` `QUERY_FAILED` or `QUERY_TIMEOUT` in 15 minutes | Read the records (`Activity write failed` carries the same codes), then `databricks warehouses get <app warehouse ID>`. A compute outage fails every read until it recovers |
| `app warehouse slow or cancelling` (`warehouse_health`) | A statement on the app warehouse was cancelled or waited over 30 s for compute in the last 30 minutes | Check the warehouse's state and events; raise `max_num_clusters` if it queues under load |
| `model calls over the rate limit` (`model_rate_limited`) | More than 10 calls got 429 in two hours; checked hourly | See [Models and rate limits](#models-and-rate-limits) |
| `model calls refused` (`model_refused`) | A call got 403 in two hours; hourly | Check the user is in the app users group ([security.md](security.md#app-users)) |
| `app error records` (`error_logs`) | An ERROR record from the app's loggers in 15 minutes | Read them with the query in [Logs](#logs). Lines Apps captures from stdout, such as pip's, have no logger and don't count |
| `unsafe or leaking answers` (`answer_quality`) | A production scorer failed an answer for safety, personal data or an ID in the last hour | Open the trace from the annotation's `target_id`; add the case to the [`dev` split](evaluation.md#splits-and-the-release-gate). Silent until the [production scorers](evaluation.md#production-scorers) run |
| `agent app permissions changed` (`app_acl_changes`) | Someone changed the agent app's permissions in two hours; hourly | Expected after `scripts/setup_identities.sh`. Otherwise find who in `system.access.audit` (`action_name = 'changeAppsAcl'`) and undo it |

A Unity Gateway policy block returns HTTP 200, so no alert counts it; the app logs `Model call failed` with `status` `POLICY_BLOCKED`.

## Troubleshooting

| You see | Do |
| :--- | :--- |
| "The assistant is unavailable at the moment." | A rate limit (429): wait a minute ([Models and rate limits](#models-and-rate-limits)) |
| "The assistant isn't available for your account." | No `EXECUTE` on the model service (403): add the user to the app users group |
| "We couldn't complete your request. Try again." | Read the `Model call failed` ERROR record. A model service that isn't deployed yet fails this way |
| "We can't help with that request." | A service policy or the provider's content filter blocked it. If ordinary questions are blocked, check the [policies](evaluation.md#guardrails) |
| "We couldn't finish this request in one go." | The run reached its 10 model calls ([backend.md](backend.md#run-bounds)): ask a narrower question |
| "We couldn't confirm the outcome." | Click "Try again": a repeated change runs once and shows "This change was already made" |
| `scripts/deploy_agent.sh`: "Could not find or create the LoggedModel" | The deployer can't edit the trace experiment, or MLflow failed: fix the printed error and rerun |
| `scripts/deploy_agent.sh`: "Failed to configure App telemetry due to an unexpected error" | Another identity ran the first deploy, so the deployer doesn't own `<project>_ops`: grant it `CREATE TABLE` there and rerun |
| `databricks bundle run app_grants`: "Missing required field: principal" | Run `scripts/setup_identities.sh`, which passes the app's application ID |

## Capacity

The app runs one Medium instance (up to 2 vCPUs and 6 GB), set by `--instances 1` in `scripts/deploy_agent.sh`. A load test on 2026-10-12 handled about 10 concurrent runs, or 100 a minute, at a p95 of 7.2 s per read question, with about 2 model calls a run. The model token limits bind before the CPU, so a second instance adds nothing. Demo traces on 2026-10-15 to 17, mostly suites and evals, had a p95 of about 20 s.

Move to `--instances 2` only once the model quota grows and the runtime runs a queued user-authorized run only on the instance that holds the user's credential.

The managed Lakebase stores have no per-agent metrics. During a deploy, runs still going about 15 s after SIGTERM fail with `MCP_USER_AUTH_RECOVERY_UNSUPPORTED`, and new requests get 502 for a few seconds, which the client retries once.

### The app's warehouse

`resources/app/app_warehouse.sql_warehouse.yml` declares `<project>-app-<target>`: serverless, Small, one to two clusters, auto-stop after 15 minutes. Only the app and the operators use it ([access.md](access.md#workspace-permissions)); jobs, alerts, the dashboard, tests and local runs use `warehouse_id`.

It isolates the app from other workloads; one cluster never queued at the model-limited rate. A workspace-wide compute outage stops it too. After a chat, this command lists only app users, operators and the app's application ID: `databricks query-history list --max-results 1000 -o json | jq -r --arg id "$(databricks bundle summary -o json | jq -r .resources.sql_warehouses.app_warehouse.id)" '.res[] | select(.warehouse_id == $id) | .user_name' | sort -u`.

## Models and rate limits

Each model service in `resources/model/` takes its foundation model from a variable; keep `app/agent/models.toml` in step ([backend.md](backend.md#models-and-effort)). The models' 1M-token context windows aren't confirmed for Databricks.

| Model service | Variable | Default | Images |
| :--- | :--- | :--- | :--- |
| `sonnet_llm`, the default | `sonnet_model` | `models/system.ai.databricks-claude-sonnet-5-5` | No |
| `opus_llm` | `opus_model` | `models/system.ai.databricks-claude-opus-5-5` | Yes |

Each service sets two limits a minute (`config.rate_limits`), so a user's limits add up across models:

| Limit | Requests | Tokens |
| :--- | :--- | :--- |
| Per user (`RATE_LIMIT_KEY_USER_DEFAULT`) | 30 | 300,000, about 30 runs |
| Per service (`RATE_LIMIT_KEY_SERVICE`) | 300 | 960,000 |

Keep the service limit below the workspace's pay-per-token quota: 960,000 sits just below a Sonnet quota of 1M tokens a minute; the Opus quota was not checked. A higher quota needs a [tier request](deployment.md#required-setup). This query reads the last hour's cached share of input tokens:

```sql
SELECT count(*) AS calls,
  sum(input_tokens) AS input_tokens,
  sum(token_details.cache_read_input_tokens) AS cache_read_tokens,
  sum(token_details.cache_creation_input_tokens) AS cache_write_tokens
FROM system.ai_gateway.usage
WHERE service_name IN ('<catalog>.<project>_ops.sonnet_llm', '<catalog>.<project>_ops.opus_llm')
  AND event_time >= now() - INTERVAL 1 HOUR
```

## Cost and budget

`system.ai_gateway.usage` records each model call's user in `requester`, with `input_tokens` and `output_tokens`.

- Model tokens, about 98% input: about 10,200 input and 256 output tokens per read question, bounded by `config.rate_limits` and the budget below.
- App warehouse: 12 DBU per hour per running cluster ([The app's warehouse](#the-apps-warehouse)).
- Apps instance: 0.5 DBU per hour.
- Trace and telemetry tables: storage for `trace_retention_days` (30).
- Evals and production scorers: about 32,000 agent tokens per question, and judge calls on 10% of traces (`--max-tokens`, `--sample-rate`: [evaluation.md](evaluation.md#run)).
- Monthly review: the last query in `docs/audit.sql`, with `catalog`, `project`, `start_date` and `end_date`, gives calls and tokens per day, user and model, with cache reads.
- Tags: `cost_tags` (default `project=<project>`, `environment=<target>`) tags the app warehouse, and `scripts/setup_identities.sh` copies them onto the model services; usage records them in `service_tags`. Where tag policies (`databricks tag-policies list-tag-policies`) restrict a key, override `cost_tags` with allowed values.
- Monthly budget (account admin): a Unity Gateway budget in the account console, scoped to the `cost_tags` tags, with an alert threshold and "Block usage" at the cap. Its estimate is near-real-time, so the cap isn't exact.
- App usage policy: `app_usage_policy_id`, which `scripts/deploy_agent.sh` sets on the app when it isn't empty.

## Recovery

- Recovery time: minutes for an agent redeploy or a table restore, about one for the `schema` job.
- Recovery point: any version from the last 7 days, the Delta default (`delta.deletedFileRetentionDuration`; predictive optimization's `VACUUM` removes older files). Set longer retention per table if needed.
- The session store has no restore: a lost conversation is gone.
- A schema change doesn't roll back with the code ([deployment.md](deployment.md#rollback)): restore the tables a bad migration touched before the old code runs.

### Restore a table

Time travel and `RESTORE` are refused on a table with a row filter or column mask (`ROW_LEVEL_SECURITY_FEATURE_NOT_SUPPORTED.TIME_TRAVEL`), as on the use-case, audit and Activity tables. So drop them, restore, and set them again, as the data owner. For example, run SQL notebook tasks in a one-time job with `run_as` the data owner, which the deployer's Service Principal User role allows.

1. Find the last good version: `DESCRIBE HISTORY <table>`.
2. Stop the app (`databricks apps stop agent-bricks-<project>`) and `` REVOKE SELECT ON TABLE <table> FROM `<app_users_group>` ``: users can still query the warehouse.
3. `ALTER TABLE <table> DROP ROW FILTER`, and `ALTER TABLE <table> ALTER COLUMN <column> DROP MASK` per masked column (`information_schema.column_masks`). If an audit table then refuses `RESTORE` as append-only, `ALTER TABLE <table> SET TBLPROPERTIES ('delta.appendOnly' = 'false')`.
4. `RESTORE TABLE <table> TO VERSION AS OF <version>`, or `TIMESTAMP AS OF '<time>'`.
5. `databricks bundle run schema` sets the filters, masks, `delta.appendOnly` and the group's `SELECT` again.
6. Check row counts, start the app (`databricks apps start agent-bricks-<project>`), and check a user sees only their own rows.

Restore each table the change touched. A dropped table comes back with `UNDROP TABLE <table>` within 7 days, then a `schema` run.

`databricks bundle run restore_rehearsal` rehearses this on a copy of each data owner table in `<project>_data`, `_ops` and `_reference`, and fails unless the restored copy's row count and checksum match. A `<table>_restore_rehearsal` copy left by a cut-off run stops the next run until you drop it.
