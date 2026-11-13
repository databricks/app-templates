# Security

The app is configured with on-behalf-of-user authorization, so each agent action stays within what Unity Catalog already permits the user, and Unity Gateway governs model calls. This page covers who acts as whom and where data goes; [access.md](access.md) lists every grant.

`<store>` is the `[session_store]` name in `app/agent.toml`. Last reviewed: 2026-10-17.

## Identities

The diagram shows the identities a request uses, and what each one reaches.

![Identities a request uses: the user client reaches model services, tables and write procedures on behalf of the user; the app client reaches reference tables, Activity, the stores, traces and ratings as the app's service principal; procedure bodies run with the data owner's rights.](images/identities.png)

1. The user signs in through the workspace's identity provider.
2. The Apps proxy forwards the user's token (`x-forwarded-access-token`) and email (`X-Forwarded-Email`). The app builds the user client per request (`app/runtime/auth.py`) and refuses one without a token.
3. Model calls run on behalf of the user (`app/agent/agent.py`), so per-user rate limits apply and Unity Gateway records the user.
4. Reads run fixed queries on behalf of the user (`app/agent/tools/user_data.py`), so the row filter and masks apply to their `session_user()`.
5. After the user approves a card, the app calls a write procedure on behalf of the user (`app/agent/approvals.py`).
6. The `SQL SECURITY DEFINER` body runs with the data owner's rights while `session_user()` stays the user: it checks the rules, writes the change and audit row, and replays on the idempotency key.
7. The app's service principal reads the reference data that users can't read (`app/agent/tools/reference_data.py`).
8. When a run ends, the app appends its Activity rows (`app/agent/activity.py`).
9. The app keeps conversations in the session store, filtered on the caller's email. It keeps runs in the runtime store (`app/runtime/stores.py`) and sends traces and ratings to MLflow.

| Identity | Who | What it does |
| :--- | :--- | :--- |
| Signed-in user | A member of `app_users_group`: a person, or a test service principal | Reads, confirmed writes and model calls |
| Agent app | The service principal Apps creates and deletes with the app | Steps 7 to 9 |
| Data owner | `<project>_data_owner`, in the back-office group | Owns the tables, the row filter, the masks and the procedures, and runs every job |
| Deployer | You in `demo` and `dev`; the deploy service principal in `staging` and `prod` | Deploys; owns the schemas and the trace, telemetry and inference tables |
| Test users and eval runner | Service principals outside `prod`, never a person | Run the workspace suites and the evals |

[access.md](access.md#groups) lists the groups and grants, and the [invariants](architecture.md#invariants) list the code's rules on clients, actors, SQL and writes. The app requests the `sql` and `ai-gateway` scopes (`app/agent.toml`); Apps adds `iam.access-control:read` and `iam.current-user:read`. The row filter compares each row's owner column with `session_user()`, an email or an application ID, so a user whose email changes is a new identity whose rows must be moved by hand.

## App users

Every user grant goes to `app_users_group`, never to a person ([access.md](access.md#unity-catalog-grants)): Unity Catalog has no deny, so a personal grant would outlive removal from the group.

- Add and remove users only by group membership, synced from your identity provider in production.
- A removal needs no deploy. Unity Catalog refuses the user once the change reaches it (the group-leave test in `tests/e2e/conftest.py` waits up to five minutes); the Apps proxy applies it about five minutes late.
- Consumer access, from the group's workspace assignment, must be users' only entitlement, because entitlements add up. Users must have no direct assignment and belong to no other group with Workspace access or Databricks SQL access. The `users` group carries none.
- Consumer access hides the authoring UI but doesn't stop API statements, so the grants and definer procedures are the boundary.

With their own token, outside the app, a user can query the app warehouse, read their own masked rows, call a write procedure without a card (its rules and audit row still apply), and call the model services without the app's prompt, tools or grounding check. They can't read the reference tables, traces, telemetry, evaluation schema, experiments, dashboard or alerts. Their `system` access depends on your metastore (`databricks grants get catalog system`): where `account users` hold `SELECT`, every user reads all of `system.ai_gateway.usage` and `system.access.audit`.

## Audit and Activity

`sql/data/audit_tables.sql` creates two append-only tables in `<project>_ops`, owned by the data owner. The row filter `own_rows_or_backoffice` shows users their own rows and shows the back-office group every row. The app's service principal holds `SELECT` and sees none.

- `action_audit`: one row per write a procedure ran, done or rejected, with `audit_id`, `occurred_at`, `action`, `actor`, `target_ids`, `amount`, `outcome`, `reason` and `idempotency_key` (core columns `NOT NULL`). The procedure writes it in the change's transaction, with `actor = session_user()`. A call refused for lack of `EXECUTE` never runs, so only `system.query.history` records it.
- `assistant_activity`: one row per tool event of a run (`RequestContext.tool_event`): tool, identity, target, outcome, status, reference and proposal ID, never row data or error text. `app/agent/activity.py` appends them as the app's service principal when a run ends, and retries once ([invariants](architecture.md#invariants)). The Activity page reads 90 days on behalf of the user.

The platform records the user rather than the app: `system.query.history` in `executed_by` (except the Activity inserts and reference reads), `system.access.audit` in `identity_metadata.run_by` (the app in `acting_resource_display_name`), `system.ai_gateway.usage` in `requester`, and each trace's user. [`docs/audit.sql`](audit.sql) holds read-only queries over these.

## Trace telemetry and inference data

These tables hold every user's data unfiltered, so few principals read them ([access.md](access.md#unity-catalog-grants)).

- Trace tables, `<project>_ops.agent_traces_otel_*` and the views `agent_traces_trace_unified` and `agent_traces_trace_metadata`: every user's prompts, answers, tool results, images, ratings with the rater's email, and scorer assessments. MLflow creates them, and the deployer owns them. The ops and evaluation groups, the agent app and the data owner read them. MLflow's trace UI may refuse the ops group, which holds `SELECT` but not `MODIFY`; SQL needs only `SELECT`.
- Apps telemetry tables, `<project>_ops.<app_telemetry_table_prefix>_otel_*`, owned by the deployer: the app's log records and platform rows that name users, the HTTP access lines (the caller as `<user ID>@<workspace ID>`, the client IP) and `app.auth` events (`enduser.id`). The ops group, the data owner and the agent app read them. Uvicorn's access log is off (`--no-access-log` in `app/app.yaml`).
- Inference tables, `<project>_ops.sonnet_llm_payload` and `opus_llm_payload`: every model request and response, with images. Only their owner, the deployer, reads them: grant them to nobody. Removing one ("inference_table is immutable after create") means recreating the model service, which drops its grants and stops the agent app's model calls until the next deploy.
- `system.ai_gateway.usage` holds no payloads. Only users who are both account and metastore admins read it by default; a metastore admin grants others `USE CATALOG`, `USE SCHEMA` and `SELECT`.

## Data lifecycle

| Store | What it holds | Retention |
| :--- | :--- | :--- |
| Use-case tables (`<project>_data`) | The use case's records | Set per engagement; nothing deletes them |
| Reference tables (`<project>_reference`) | Shared reference data, no personal data | Kept |
| `action_audit`, `assistant_activity` | Writes and tool events | Append-only; the Activity page shows 90 days |
| Trace and Apps telemetry tables | Every user's traces, ratings, log records, access lines and `app.auth` events | `trace_retention_days` (default 30), enforced daily by the `trace_retention` job |
| Inference tables | Model requests and responses, with images | Until the model service is recreated without one |
| Session store (`<store>`, managed) | Conversation titles and transcripts, with images | Until the user deletes the conversation |
| Runtime store (managed, one per app) | Each run's input and events | Until the app is deleted |
| Evaluation data (`<project>_eval`, the evals experiment) | Datasets, the prompt, eval runs and labels, from test users only | Kept |
| `system.ai_gateway.usage` | Tokens per call and requester | Set by the platform |

- Recovery: `UNDROP TABLE` restores a dropped table within 7 days while its schema exists; a dropped schema, function, view, volume or model is gone ([runbook.md](runbook.md#recovery)). The managed stores document no recovery; a deleted experiment stays in its owner's Trash for 30 days.
- The use-case, audit and Activity tables get deletion vectors from the workspace default (`SHOW TBLPROPERTIES <table> ('delta.enableDeletionVectors')`), so deleted rows can stay in storage until `REORG TABLE ... APPLY (PURGE)`. The trace, telemetry and inference tables have none: deleted rows leave storage after `delta.deletedFileRetentionDuration` (7 days by default) and the next `VACUUM`, which `trace_retention` runs on the trace and telemetry tables.
- An image goes with its question as a data URL (at most 3, `app/runtime/schemas.py`), so it is stored wherever the question is.
- Dictation and read-aloud run in the browser's Web Speech API instead of the server, but Chrome sends dictation audio to a Google service, and a non-local voice sends the answer's text to its speech service.
- Deleting a conversation removes it from the session store only, as the dialog says: its runs stay in the runtime store, and its traces stay until their retention ends.
