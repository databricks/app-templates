# Access

This page lists every group, service principal, grant and permission this example sets, with the file that declares it. [security.md](security.md#identities) explains why each identity exists.

Names are the defaults; each group comes from its variable in `databricks.yml`. "The deployer" runs `databricks bundle deploy` and `scripts/deploy_agent.sh`: you in `demo` and `dev`, the deploy service principal in `staging` and `prod`. Use-case objects are named by role ([customization.md](customization.md)). Last checked on a deployed `demo` target: 2026-10-17.

## Groups

All are account groups. `scripts/setup_identities.sh` creates all but `maintainer_group`, and gives each but the back-office group a workspace assignment with Consumer access (`ensure_consumer_access`). App users need it to sign in, and the bundle's permissions can name only an assigned group. An assignment needs one entitlement.

| Variable, default name | Members | Who adds them | What it is for |
| :--- | :--- | :--- | :--- |
| `app_users_group`, `<project>_app_users` | App users; the two test users; in `demo`, the two demo users | Your identity provider's sync in production; `scripts/setup_identities.sh` (test users); `demo/add_demo_users.sh` | Holds every user grant |
| `backoffice_group`, `<project>_backoffice` | The data owner | `scripts/setup_identities.sh` | Sees every row unmasked; holds no grant and no workspace assignment |
| `ops_group`, `<project>_ops_readers` | Operators and developers, none at first | You: `databricks workspace-iam-v2 create-direct-group-member-proxy <group ID> <principal ID>` | Reads traces, telemetry and evaluation datasets on the app warehouse; views the experiments, dashboard and alerts |
| `agent_apps_group`, `<project>_agent_apps` | The agent app's service principal | `scripts/setup_identities.sh` | Lets the bundle's permissions name the app, so deploys keep its access |
| `eval_group`, `<project>_eval_writers` | The eval runner | `scripts/setup_identities.sh` | Writes `<project>_eval`, runs the evals and registers the production scorers |
| `maintainer_group`, no default | Maintainers of `staging` and `prod` | You, before the first deploy | `CAN_VIEW` on every bundle resource in `staging` and `prod`. Empty in `demo` and `dev` |

### Developers

In `demo` and `dev` a developer is the deployer. In `staging` and `prod`:

- Read traces, telemetry and evaluation datasets through `ops_group`; view the bundle's resources through `maintainer_group`.
- Deploy only through CI. `CAN_MANAGE` on a job that runs as the data owner would let a person edit its notebook and run any SQL as the data owner, because Run now takes the Run as identity's permissions.
- Never make developers workspace admins: `admins` inherits `CAN_MANAGE` on every object.
- Developers don't read the owner-only inference tables.
- Evals run in CI. A run by hand needs the service principal manager role on the eval runner, which mints its secrets.

## Service principals

| Principal | Created by | Entitlements | Roles others hold on it | What it does |
| :--- | :--- | :--- | :--- | :--- |
| Data owner, `<project>_data_owner` (`data_owner_application_id`) | `scripts/setup_identities.sh` | Workspace access, Databricks SQL access | The deployer: service principal user (`ensure_service_principal_user_role`), for a job's `run_as`, and manager | Owns the tables, the row filter, the masks and the procedures, and runs every job: `schema`, `app_grants`, `trace_retention`, `restore_rehearsal`, `reset_data` in `demo` and `staging`, and `sample_data` in `demo` |
| Agent app | Apps, with the app, and deleted with it | Workspace access, Databricks SQL access, set by Apps | The deployer: manager | The app's own calls ([security.md](security.md#identities)) |
| Test users one and two, `<project>_test_user_one` and `_two` (`test_user_one_id`, `test_user_two_id`) | `scripts/setup_identities.sh`, not in `prod` | Consumer access, direct (`ensure_test_identity`) | The deployer: manager, which mints their one-hour secrets (`scripts/test_user_token.sh`, `tests/conftest.py`) | The workspace suites run as them |
| Eval runner, `<project>_test_user_eval` (`test_user_eval_id`) | `scripts/setup_identities.sh`, not in `prod` | Workspace access | The deployer: manager | Runs the evals and the production scorers |
| Deploy service principal, one per `staging` and `prod` workspace | You, with a GitHub federation policy ([deployment.md](deployment.md#required-setup)) | Member of `admins`, for `scripts/setup_identities.sh` | None | CI's deployer (`.github/workflows/deploy.yml`) |

The deployer holds:

- Workspace admin, to create service principals and groups (`scripts/first_deploy.sh` checks it).
- `MANAGE` on the catalog, a prerequisite, and `CREATE_SCHEMA`, which the setup script grants.
- Ownership of the four schemas and the trace, telemetry and inference tables; it also creates the model services, experiments, jobs, app warehouse and app.
- `CAN_MANAGE` on every bundle resource and the app ([Workspace permissions](#workspace-permissions)).

## Unity Catalog grants

Users never get `MODIFY`. The workspace suites stop while a test user holds `ALL_PRIVILEGES`, `MODIFY` or catalog-wide `EXECUTE` (`tests/conftest.py`), and fail if a grant names a person (`tests/integration/test_schema.py`).

| Securable | Principal | Privileges | Declared in |
| :--- | :--- | :--- | :--- |
| Catalog | `app_users_group`, `ops_group`, `eval_group`, the data owner, the agent app | `USE_CATALOG` | `scripts/setup_identities.sh` |
| Catalog | The deployer | `CREATE_SCHEMA`; `MANAGE` beforehand | `scripts/setup_identities.sh`; [deployment.md](deployment.md#prerequisites) |
| `<project>_data` | The data owner | `USE_SCHEMA`, `CREATE_TABLE` | `resources/data/data.schema.yml` |
| `<project>_data` | `app_users_group` | `USE_SCHEMA` | `resources/data/data.schema.yml` |
| `<project>_reference` | The data owner | `USE_SCHEMA`, `CREATE_TABLE` | `resources/data/reference.schema.yml` |
| `<project>_reference` | `agent_apps_group` | `USE_SCHEMA` | `resources/data/reference.schema.yml` |
| `<project>_ops` | The data owner | `USE_SCHEMA`, `CREATE_TABLE`, `CREATE_FUNCTION` | `resources/data/ops.schema.yml` |
| `<project>_ops` | `app_users_group`, `agent_apps_group`, `ops_group`, `eval_group` | `USE_SCHEMA` | `resources/data/ops.schema.yml` |
| `<project>_ops` | The agent app | `USE_SCHEMA` | Apps telemetry export. A bundle deploy removes it; the app keeps it through `agent_apps_group` |
| `<project>_eval` | `eval_group` | `USE_SCHEMA`, `CREATE_TABLE`, `CREATE_FUNCTION`, `EXECUTE`, `MANAGE` | `resources/evals/eval.schema.yml` |
| `<project>_eval` | `ops_group` | `USE_SCHEMA`, `SELECT` | `resources/evals/eval.schema.yml` |
| Each use-case table | `app_users_group` | `SELECT` | `sql/data/user_grants.sql` |
| Each write procedure | `app_users_group` | `EXECUTE` | `sql/data/user_grants.sql` |
| Each reference table | The agent app | `SELECT` | `sql/app/reference_grants.sql`, through the `app_grants` job |
| `<project>_ops.action_audit` | `app_users_group` | `SELECT` | `sql/data/audit_tables.sql` |
| `<project>_ops.action_audit` | The agent app | `SELECT` | `sql/app/audit_grants.sql` |
| `<project>_ops.assistant_activity` | `app_users_group` | `SELECT` | `sql/data/audit_tables.sql` |
| `<project>_ops.assistant_activity` | The agent app | `SELECT`, `MODIFY` | `sql/app/audit_grants.sql` |
| Model services `<project>_ops.sonnet_llm`, `opus_llm` | `app_users_group` | `EXECUTE` | `resources/model/*.model_service.yml` |
| Trace tables `<project>_ops.agent_traces_otel_spans`, `_logs`, `_metrics`, `_annotations` | `ops_group` | `SELECT` | `scripts/setup_identities.sh` (`grant_trace_tables`) |
| Trace tables | The data owner | `SELECT`, `MODIFY` | `scripts/setup_identities.sh` (`grant_trace_tables`) |
| Trace tables | The agent app | `SELECT`, `MODIFY` | The `agentbricks-trace-*` app resources, from `agentbricks deploy` |
| `agent_traces_otel_spans`, `agent_traces_otel_annotations` | `eval_group` | `SELECT`; `MODIFY` on the annotations | `scripts/setup_identities.sh` (`grant_trace_tables`) |
| View `<project>_ops.agent_traces_trace_unified` | `ops_group`, `eval_group` | `SELECT` | `scripts/setup_identities.sh` (`grant_trace_tables`) |
| View `<project>_ops.agent_traces_trace_metadata` | None | | |
| Telemetry tables `<project>_ops.<app_telemetry_table_prefix>_otel_logs`, `_metrics`, `_spans`, `_annotations` | `ops_group`; the data owner | `SELECT`; `SELECT`, `MODIFY` | `scripts/setup_identities.sh` (`grant_trace_tables`) |
| Telemetry logs, metrics and spans tables | The agent app | `SELECT`, `MODIFY` | Apps telemetry export, which `scripts/deploy_agent.sh` sets |
| Inference tables `<project>_ops.sonnet_llm_payload`, `opus_llm_payload` | None | | Owner only, by design |

The list [above](#service-principals) shows the deployer's objects. The data owner owns every table, function and procedure the `schema` job creates, and the eval runner owns the evaluation datasets and the prompt that `python -m evals run` creates. The catalog's owner, outside the repo, holds every privilege in the catalog.

## Row filters and column masks

The `schema` job sets these as the data owner on every run.

| Policy | Created in | Set on | What it does |
| :--- | :--- | :--- | :--- |
| Row filter `<project>_ops.own_rows_or_backoffice` | `sql/data/audit_tables.sql` | `action_audit` on `actor` and `assistant_activity` on `owner_email`; each use-case table's owner column (`sql/data/row_filters.sql`) | Returns rows whose owner column equals `session_user()`, or every row to `backoffice_group` |
| Column masks | `sql/data/column_masks.sql` | The columns that file names | Shows the full value only to `backoffice_group` |

- The agent app sees no audit or Activity rows: it is neither an owner nor in the back-office group.
- A definer procedure keeps `session_user()`, so the filter checks the caller inside a write too.
- A table with a row filter or mask can't have `CHECK` constraints, so the rules live in the procedures. Time travel and clones don't work on it either ([runbook.md](runbook.md#recovery)).

## Workspace permissions

| Object | Principal | Level | Declared in |
| :--- | :--- | :--- | :--- |
| Every bundle resource and the bundle's root folder | The data owner | `CAN_VIEW` (`CAN_READ` on experiments, the dashboard, alerts and the folder) | `databricks.yml`, top-level `permissions` |
| Every bundle resource and the root folder | The deployer | `CAN_MANAGE` (`IS_OWNER` on the jobs and the app warehouse) | `demo/target.yml`; `databricks.yml`, the `dev`, `staging` and `prod` targets |
| Every bundle resource and the root folder | `maintainer_group` | `CAN_VIEW` | `databricks.yml`, the `staging` and `prod` targets |
| App warehouse `<project>-app-<target>` | `app_users_group`, `agent_apps_group`, `ops_group` | `CAN_USE` | `resources/app/app_warehouse.sql_warehouse.yml` |
| App warehouse | The agent app | `CAN_USE` | The `app_warehouse` app resource, from `scripts/deploy_agent.sh` |
| Trace experiment `<root>/<project>-traces` | `agent_apps_group`, `eval_group`; `ops_group` | `CAN_EDIT`; `CAN_READ` | `resources/observability/agent_traces.experiment.yml` |
| Trace experiment | The agent app | `CAN_EDIT` | The `agentbricks-trace-experiment` app resource, from `agentbricks deploy` |
| Evals experiment `<root>/<project>-evals` | `eval_group`; `ops_group` | `CAN_MANAGE`; `CAN_READ` | `resources/evals/evals.experiment.yml` |
| Operations dashboard | `ops_group` | `CAN_READ` | `resources/observability/operations.dashboard.yml` |
| The nine alerts | `ops_group` | `CAN_READ` | `resources/observability/*.alert.yml` |
| Agent app `agent-bricks-<project>` | `app_users_group` | `CAN_USE` | `scripts/setup_identities.sh` (`grant_app_use`) |
| Agent app | Test users one and two | `CAN_USE`, direct | `scripts/setup_identities.sh` (`grant_app_use`) |
| Agent app | The deployer | `CAN_MANAGE` | `agentbricks deploy`, which creates it |

- The test users also hold Consumer access and `CAN_USE` on the app directly, for the group-leave test ([development.md](development.md#test-users)).
- The dashboard is published without embedded credentials (`embed_credentials: false`): each viewer's data permissions decide what they see, on the publisher's compute.
- The bundle sets no permission on the shared `warehouse_id`: the data owner, the test users, the eval runner and the deployer each need `CAN_USE` on it.
- The session store has no permissions API ("'session-stores' is not a supported object type for permissions"). The app uses it as itself, and `app/runtime/stores.py` returns only sessions whose `actor_id` is the caller's email.
- Apps have two permission levels, `CAN_USE` and `CAN_MANAGE`.

## Check access

Every command only reads. Object IDs come from `databricks bundle summary -o json`.

- Grants on one securable: `databricks grants get catalog <catalog>`, `databricks grants get schema <catalog>.<project>_ops`, `databricks grants get table <catalog>.<project>_ops.assistant_activity`, `databricks grants get model_service <catalog>.<project>_ops.sonnet_llm`. In SQL: `SHOW GRANTS ON TABLE <catalog>.<project>_ops.assistant_activity`.
- One principal's grants, inherited ones included: `databricks grants get-effective schema <catalog>.<project>_ops --principal <group or application ID>`.
- Row filters and masks in force: `SELECT table_schema, table_name, filter_name, target_columns FROM <catalog>.information_schema.row_filters WHERE table_schema LIKE '<project>\_%'`, and `SELECT table_schema, table_name, column_name, mask_name` from `information_schema.column_masks` with the same filter.
- Workspace permissions: `databricks apps get-permissions agent-bricks-<project>`, and `databricks api get /api/2.0/permissions/<type>/<ID>` with `warehouses`, `experiments`, `jobs`, `dashboards`, `alertsv2` or `directories` (the root folder's object ID from `databricks workspace get-status <root_path>`).
- Entitlements and members: `databricks workspace-iam-v2 get-workspace-assignment-proxy <principal ID>` and `databricks workspace-iam-v2 list-direct-group-members-proxy <group ID>`.
- The app's resources and scopes: `resources`, `user_api_scopes` and `effective_user_api_scopes` in `databricks apps get agent-bricks-<project>`.

The [workspace suites](development.md#tests) check most of this: `tests/integration/test_schema.py` (no grant names a person; the evaluation schema), `test_trace_access.py` (who reads the trace, telemetry and inference tables, and the grant chain), `test_warehouse.py` (the app warehouse), `test_user_access.py` (what a test user can read and change) and `tests/e2e/test_agent_app.py` (leaving the group refuses the next write).
