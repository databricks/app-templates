# Deployment

Run every command from the repo root after `export DATABRICKS_CONFIG_PROFILE=<profile>`. The deployer runs `databricks bundle deploy` and `scripts/deploy_agent.sh`. You deploy `demo` and `dev`, and the environment's deploy service principal deploys `staging` and `prod`. [development.md](development.md) covers local work.

## Required setup

These tables list the steps the scripts and CI can't do, who does each and how to check it.

### Before the first deploy

| Step | Who | Check |
| :--- | :--- | :--- |
| A workspace with Databricks Apps, Agent Bricks and Unity Gateway | Account admin | `databricks apps list` exits 0 |
| `sonnet_model` and `opus_model` on pay-per-token in the workspace's region | Account admin | `databricks serving-endpoints get <model>`, such as `databricks-claude-sonnet-5-5`, shows `"ready": "READY"` for each |
| Workspace admin for the deployer | Workspace admin | `databricks current-user me -o json \| jq '[.groups[]?.display] \| index("admins")'` prints a number |
| `MANAGE` and `USE_CATALOG` on a catalog for the deployer | Metastore admin or the catalog's owner | `databricks grants get-effective catalog <catalog> --principal <deployer>` lists both |
| A SQL warehouse the deployer can use (`warehouse_id`) | Workspace admin | `databricks warehouses get <warehouse_id>` exits 0 |
| [`cost_tags`](runbook.md#cost-and-budget) that the account's tag policies allow (the default `project=<project>` fails where a policy governs `project`) | The deployer; an account admin owns the tag policies | `scripts/first_deploy.sh` stops and names each refused tag with its allowed values; `databricks tag-policies list-tag-policies` shows the governed keys |
| `sql` and `ai-gateway` user API scopes for apps, if the workspace limits them | Workspace admin | After the first deploy, `databricks apps get agent-bricks-<project> -o json \| jq .effective_user_api_scopes` lists both |
| `demo` only: two workspace users as the demo users | Workspace admin | `demo/add_demo_users.sh` finds both |

### Before CI deploys

| Step | Who | Check |
| :--- | :--- | :--- |
| A [deploy service principal](#deploy-service-principal) per environment, in `admins`, with `MANAGE` and `USE_CATALOG` | Workspace admin; the catalog's owner for the grant | `databricks service-principals list --filter 'displayName eq "<project>-deploy-<target>"'` returns it; `databricks grants get-effective catalog <catalog> --principal <application ID>` lists both |
| Its GitHub OIDC federation policy, one per GitHub environment | Account admin | `databricks account service-principal-federation-policy list <service principal ID>` shows `repo:<org>/<repo>:environment:<target>`; `bundle-validate` passes |
| GitHub environments `staging` and `prod`, `prod` with required reviewers, and their [variables](#github-environments-and-variables) | GitHub repository admin | `gh api repos/<org>/<repo>/environments --jq '.environments[].name'` lists both; `gh variable list --env <target>` lists the variables |
| Each environment's [first deploy](#as-the-deploy-service-principal) | The service principal's manager | `gh variable list --env <target>` lists `DATA_OWNER_APPLICATION_ID`, and in `staging` the three `TEST_USER_*_ID` |

### Before users get access

| Step | Who | Check |
| :--- | :--- | :--- |
| The Unity Ai Gateway Service Policies preview (Beta), on the workspace's Previews page | Workspace admin | A model service's Unity Gateway page offers service policies |
| [Guardrail service policies](evaluation.md#guardrails) on the input and output of `<project>_ops.sonnet_llm` and `opus_llm`, in the Unity Gateway UI | A person with `MANAGE` on the model services, which the deployer owns and grants | `uv run --package app python -m evals run --split dev --categories guardrails --k 1` passes; a blocked response carries `databricks_service_policy` |
| A pay-per-token quota above Tier 1 (1,000,000 input tokens a minute for partner models), if the load needs it | Workspace admin, by quota request | Each model's granted input tokens a minute covers the sum of its services' `RATE_LIMIT_KEY_SERVICE` `tokens` in `resources/model/` |
| Sync `app_users_group` from your identity provider | Account admin, with the identity provider's admin | `databricks workspace-iam-v2 list-direct-group-members-proxy <group ID>` lists only the intended users |
| [Consumer access](security.md#app-users) as app users' only entitlement | Workspace admin | `databricks workspace-iam-v2 get-workspace-assignment-proxy <user ID>` shows no direct assignment, or only `WORKSPACE_CONSUME` |
| Operators in `ops_group`: `databricks workspace-iam-v2 create-direct-group-member-proxy <group ID> <principal ID>` | Workspace admin | `databricks workspace-iam-v2 list-direct-group-members-proxy <group ID>` lists them |
| `SELECT` on `system.ai_gateway.usage` for the dashboard's viewers | Metastore admin | `databricks grants get-effective table system.ai_gateway.usage --principal <ops_group>` lists `SELECT` |
| A monthly Unity Gateway [budget](runbook.md#cost-and-budget) on the `cost_tags` tags, with Block usage at the cap | Account admin, or a workspace admin for their workspace | The account console's budgets page lists it |
| Optional: a serverless usage policy in `app_usage_policy_id` | Workspace admin | After a deploy, `databricks apps get agent-bricks-<project> -o json \| jq .usage_policy_id` prints it |

### Ongoing

| Step | Who | Check |
| :--- | :--- | :--- |
| [Label answers](evaluation.md#judges-and-labeling) until each judge's agreement reaches 0.8 | Domain experts, in the Review App | `evals/judge_agreement.json` lists the judge at 0.8 or more |
| [Production scorers](evaluation.md#production-scorers): `uv run --package app python -m evals schedule` scores 10% of production traces and spends tokens while it runs | The app's spend owner decides; it runs as the eval runner | It prints `<scorer>: scoring 10%`; the trace experiment's Scorers tab lists `safety`, `pii_detection` and `reply_shows_an_id` |
| Before `npm --prefix frontend test`, [drop](development.md#workspace-suites) your `ALL_PRIVILEGES` and `MODIFY` on the catalog | You, or the catalog's owner | `databricks grants get-effective catalog <catalog> --principal <you>` lists neither |
| Older deployments: [bind the schemas](#versions-and-upgrades) a `schema` job created | The deployer, once | `databricks bundle summary -o json \| jq '.resources.schemas \| map_values(.id)'` shows four IDs |

## Prerequisites

Do the steps in [Before the first deploy](#before-the-first-deploy) and install these tools. `scripts/first_deploy.sh` stops without `databricks`, `jq`, `npm` or `agentbricks`.

- The Databricks CLI 1.20.0 or later, which `databricks.yml` requires.
- The Agent Bricks CLI 0.5.0, the version `app/pyproject.toml` pins: `uv tool install databricks-agentbricks==0.5.0`. `scripts/first_deploy.sh` stops on another version.
- uv, which installs Python 3.11.
- Node with npm (CI uses Node 22), jq, git and make.

## Configuration

Nothing in the repo names a workspace: your CLI profile picks it locally, and `DATABRICKS_HOST` picks it in CI. The bundle has these targets:

- `demo`, the default (`demo/target.yml`): `sample_data` and `reset_data` jobs load the test data, then the demo users' data. You get `CAN_MANAGE`.
- `dev`: no data jobs. You get `CAN_MANAGE`.
- `staging` and `prod`: production mode, one workspace each. CI deploys them as the deploy service principal. `maintainer_group` gets `CAN_VIEW`. `staging` has `reset_data` with the test data only (`tests/fixtures/test_data.yml`); `prod` has no test users and no data jobs.

Put a target's values in `.databricks/bundle/<target>/variable-overrides.json`, which git ignores. For `demo`:

```json
{
  "catalog": "<catalog>",
  "warehouse_id": "<SQL warehouse ID>",
  "demo_user_one_email": "<first user's email>",
  "demo_user_one_name": "<first user's name>",
  "demo_user_two_email": "<second user's email>",
  "demo_user_two_name": "<second user's name>"
}
```

Where the account's tag policies govern `project` or `environment`, also set `cost_tags` to allowed keys and values, such as `"cost_tags": [{"key": "<key>", "value": "<allowed value>"}, {"key": "environment", "value": "<target>"}]`. The error "no value assigned to required variable <name>" names a missing value. Values resolve in this order: `--var`, `BUNDLE_VAR_<name>`, the overrides file, the target's `variables`, the default. CI writes the file from the [GitHub variables](#github-environments-and-variables).

`databricks.yml` and `use_case.yml` describe each variable:

- In `use_case.yml`: `project` (default `agent`), kept equal to `bundle.name` in `databricks.yml` (`scripts/check_bundle_name.sh` checks it) and `deployment_name` in `app/agent.toml`, whose `[session_store]` name must be `<project>-sessions` (`scripts/deploy_agent.sh` checks both), and `display_name`.
- Required: `catalog`; `warehouse_id`, for the jobs, alerts, dashboard, tests and local runs, not the deployed app; `maintainer_group` in `staging` and `prod`.
- Written by `scripts/setup_identities.sh`: `data_owner_application_id`, `test_user_one_id`, `test_user_two_id`, `test_user_eval_id`.
- With defaults: `data_owner_name`, the five [group variables](access.md#groups), `test_user_one_name`, `test_user_two_name` and `test_user_eval_name` (empty in `prod`), `agent_app_name` (keep `agent-bricks-<project>`), `sonnet_model`, `opus_model`, `cost_tags`, `app_usage_policy_id`, `pip_index_url`, `trace_retention_days`, `alert_subscriptions`, `app_telemetry_table_prefix`.

## First deploy

1. Do [Before the first deploy](#before-the-first-deploy) and create the [overrides file](#configuration).
2. Run `scripts/first_deploy.sh [target]`. It checks the tools, your admin rights, the catalog, the warehouse and that the tag policies allow `cost_tags`, then runs:
   1. `scripts/setup_identities.sh`: the [identities](access.md#service-principals) and groups, writing the service principals' IDs to the overrides file.
   2. `demo/add_demo_users.sh`, in `demo`.
   3. `databricks bundle deploy`, schemas first.
   4. `databricks bundle run schema` (`resources/data/schema.job.yml`).
   5. `databricks bundle run reset_data`, in `demo` and `staging`.
   6. `scripts/deploy_agent.sh` ([Agent app](#agent-app)).
   7. `scripts/setup_identities.sh` again, for what needs the app: the model service tags, the app's grants (`app_grants`), `CAN_USE` and group, and the trace and telemetry table grants.
3. Run the [workspace suites](development.md#workspace-suites).

Every step is safe to rerun: fix what a failed step names and rerun the script. Run the first deploy as the identity that deploys later, or give that identity `MANAGE` on the catalog: the bundle manages the schemas' grants.

### As the deploy service principal

CI can't run a first deploy: it deploys the bundle before the setup script creates the groups and data owner that the bundle's grants name. Run it once from your machine for `staging` and `prod`:

1. Do [Before CI deploys](#before-ci-deploys) up to the federation policy.
2. As the service principal's manager, run `databricks service-principal-secrets-proxy create <service principal ID> --lifetime 3600s -o json`. Note the `id` and the `secret`.
3. Add a profile to `~/.databrickscfg` with `host`, `client_id` (the application ID) and `client_secret`.
4. Create the overrides file with `catalog`, `warehouse_id` and `maintainer_group`.
5. Run `DATABRICKS_CONFIG_PROFILE=<its profile> scripts/first_deploy.sh <target>`.
6. With your own profile, run `databricks service-principal-secrets-proxy delete <service principal ID> <secret id>`. Then remove its profile.
7. Copy the IDs the setup script wrote into the environment's GitHub variables: `DATA_OWNER_APPLICATION_ID`, and in `staging` `TEST_USER_ONE_ID`, `TEST_USER_TWO_ID` and `TEST_USER_EVAL_ID`.
8. Open a pull request from a branch: `bundle-validate` must pass.

## Deploy a change

`make deploy TARGET=<target>` runs what CI runs, in order. Without `TARGET`, it uses the default target.

```bash
scripts/check_bundle_name.sh <target>
databricks bundle deploy -t <target>
databricks bundle run -t <target> schema
scripts/deploy_agent.sh <target>
scripts/setup_identities.sh <target>
```

### Bundle resources

The bundle declares no app. It gives the app warehouse's `CAN_USE` and the trace experiment's `CAN_EDIT` to `agent_apps_group`, which holds the app's service principal, so a deploy keeps the app's access. Never rename a resource key in `resources/`: a new key recreates the resource.

### Agent app

Commit the rebuilt `app/static/` ([frontend.md#build](frontend.md#build)), then run `scripts/deploy_agent.sh`, the only way `agentbricks deploy` runs here, and `scripts/setup_identities.sh`. The deploy script ([why](architecture.md#a-script-adds-the-deploy-steps-the-agent-bricks-cli-lacks)):

1. Stops if `app/app.yaml` or `app/agent.toml` differs from the last commit, a fresh build differs from `app/static/`, or the app warehouse or trace experiment isn't deployed.
2. Finds or creates the LoggedModel `<project>-<commit>` ([runbook.md#versions](runbook.md#versions)), or stops.
3. Appends `APP_CATALOG`, `APP_PROJECT`, `APP_VERSION`, `APP_ENVIRONMENT` and `MLFLOW_ACTIVE_MODEL_ID` to `env` in `app/app.yaml`, and the trace experiment's name to `app/agent.toml`.
4. Sets the app's `app_warehouse` resource, `app_usage_policy_id` when set, and the telemetry export to `<project>_ops.<app_telemetry_table_prefix>_otel_*` before the deploy, because a running process exports only after a restart.
5. Runs `agentbricks deploy --instances 1` with `--pip-index-url` from `pip_index_url`. A new app deploys twice, so `APP_WAREHOUSE_ID` and `MLFLOW_TRACING_SQL_WAREHOUSE_ID` resolve from the resource (`valueFrom`).
6. Checks the telemetry export and restores both files. Never commit the env `agentbricks deploy` writes into `app/app.yaml`.

### Another target

Deploy `staging` and `prod` only as their deploy service principal: as a person, `databricks bundle validate --strict -t prod` stops on a warning that your folder permissions are not in the bundle.

### Protected resources

The four schemas, the trace experiment and the model services have `lifecycle.prevent_destroy`, so a deploy that would delete or recreate them fails.

- Change the trace experiment's `trace_location`, which recreates it: remove `prevent_destroy` from `resources/observability/agent_traces.experiment.yml`, deploy, put it back, deploy, then run `scripts/deploy_agent.sh` to rebind the app.
- Delete a model service: take it out of `app/agent/models.toml` and deploy the agent; remove `prevent_destroy` from its file and deploy; delete the file, its variable and its name in the model alerts and the dashboard, check that `databricks bundle plan` deletes only that service, and deploy. Its inference table stays: `databricks tables delete` drops it.

## CI/CD

The workflows in `.github/` are a template: GitHub runs them only from a repository's root, so they run once this project is copied into its own repo. Every job runs on `ubuntu-latest`, with actions pinned by commit SHA, a read-only token by default and a timeout. No job stores a secret: Databricks sign-in uses GitHub OIDC as the environment's deploy service principal. [.github/workflows/README.md](../.github/workflows/README.md) has the targets and the release flow.

### Pull requests

`.github/workflows/pr.yml` runs these jobs on every pull request, and a newer push cancels the run in progress:

- `pre-commit`: the [checks](development.md#checks), with `uv run --locked`, which fails when `uv.lock` is out of date.
- `unit-backend` and `unit-frontend`: the [unit and UI tests](development.md#unit-and-ui-tests), with `uv run --frozen`, and a check that a fresh build matches `app/static/`.
- `npm-audit`: `npm --prefix frontend audit --audit-level=high`.
- `pip-audit`: `uvx pip-audit -r app/requirements.txt --no-deps`.
- `bundle-validate`: `databricks bundle validate --strict -t staging` as the staging deploy service principal, through GitHub OIDC.

A fork's pull request gets no OIDC token, so `bundle-validate` skips.

### Deploys

`.github/workflows/deploy.yml` deploys `staging` on a push to `main`, and `prod` on a `v*` tag once the `prod` environment's reviewers approve. `release_tag.yml` creates that tag when a pull request from a `release/vX.Y.Z` branch merges ([branches and releases](../.github/workflows/README.md#branches-and-releases)).

Each run writes the overrides file from the environment's variables, installs the CLIs and runs [Deploy a change](#deploy-a-change) with `UV_FROZEN=1`, so uv installs exactly what `uv.lock` pins. `staging` then runs `reset_data`, the workspace pytest suites, `test:deployed` and the [eval gate](evaluation.md#splits-and-the-release-gate). `prod` runs none of them: it requests `/` with the deploy service principal's token until the app answers, for up to 5 minutes, and prints the app's logs if it doesn't. A failed `prod` run writes the [rollback](#rollback) steps to the job summary.

The deploy service principal must stay a workspace admin for `scripts/setup_identities.sh`.

### GitHub environments and variables

Each environment holds:

- `DATABRICKS_HOST`: the workspace URL.
- `DATABRICKS_CLIENT_ID`: the deploy service principal's application ID.
- `CATALOG`, `WAREHOUSE_ID` and `MAINTAINER_GROUP`.
- After the first deploy: `DATA_OWNER_APPLICATION_ID`, and in `staging` `TEST_USER_ONE_ID`, `TEST_USER_TWO_ID` and `TEST_USER_EVAL_ID`.
- Any other bundle variable, in upper case, only to override its default. The workflows drop empty values, and can't set the lists `cost_tags` and `alert_subscriptions`.

Set no `TEST_USER_*` variable in `prod`: the overrides file wins over the target's empty values, so the setup script would give test users one and two `CAN_USE` on the app.

### Deploy service principal

Create one per environment:

1. In the environment's workspace, a workspace admin runs `databricks service-principals create --display-name <project>-deploy-<target> -o json`. Note its `applicationId` (for `DATABRICKS_CLIENT_ID`) and its numeric `id`.
2. The workspace admin adds it to the `admins` group under Settings, Identity and access. The catalog's owner runs `databricks grants update catalog <catalog> --json '{"changes":[{"principal":"<application ID>","add":["MANAGE","USE_CATALOG"]}]}'`.
3. An account admin adds a federation policy for each GitHub environment: `databricks account service-principal-federation-policy create <service principal ID> --json '{"oidc_policy": {"issuer": "https://token.actions.githubusercontent.com", "audiences": ["<account ID>"], "subject": "repo:<org>/<repo>:environment:<target>"}}'`. A repository created, renamed or transferred on or after 2026-07-15 uses `repo:<org>@<org ID>/<repo>@<repo ID>:environment:<target>`. `bundle-validate` also uses the `staging` environment, so one policy covers both workflows there.

## Workspace resources

This list groups every object the repo creates by its creator. `<root>` is the bundle's root path, `/Workspace/Users/<deployer>/.bundle/<project>/<target>` by default. [access.md](access.md) lists owners and access.

- `scripts/setup_identities.sh`: the service principals `<project>_data_owner` and, outside `prod`, `<project>_test_user_one`, `_two` and `_eval`; the account groups `<project>_app_users`, `_backoffice`, `_ops_readers`, `_eval_writers` and `_agent_apps`.
- The bundle, from `resources/`: the schemas `<catalog>.<project>_data`, `_reference`, `_ops` and `_eval`; the model services `<project>_ops.sonnet_llm` and `opus_llm`, which create the inference tables `sonnet_llm_payload` and `opus_llm_payload`; the experiments `<root>/<project>-traces` and `<root>/<project>-evals`; the SQL warehouse `<project>-app-<target>`; nine alerts `<display_name>: <check>` and the dashboard `<display_name> assistant operations`; the workspace files in `<root>/files`.
- Jobs, which run as the data owner: `<project>_schema`, `_app_grants` (run by `scripts/setup_identities.sh`), `_trace_retention` (daily) and `_restore_rehearsal` ([on demand](runbook.md#recovery)), from `resources/`; `_reset_data` in `demo` and `staging` and `_sample_data` in `demo`, from `tests/fixtures/test_data.yml` and `demo/target.yml`.
- The `schema` job, from `sql/data/`: the use case's tables, column masks, definer write procedures and any function tools; `<project>_ops.action_audit`, `assistant_activity` and the row filter `own_rows_or_backoffice`.
- MLflow, from the trace experiment's trace location: `<project>_ops.agent_traces_otel_spans`, `_logs`, `_metrics` and `_annotations`, and the views `agent_traces_trace_metadata` and `agent_traces_trace_unified`.
- `scripts/deploy_agent.sh`: a LoggedModel `<project>-<commit>` per deployed commit, the app's source in `<root>/app`, and through `agentbricks deploy` the app `agent-bricks-<project>`, its service principal, its runtime store (managed Lakebase) and the session store named in `[session_store]` of `app/agent.toml`. The Apps telemetry export it sets creates `<project>_ops.agent_app_otel_logs`, `_metrics`, `_spans` and `_annotations`.
- `python -m evals`: `run` creates the datasets `<project>_eval.evals_dev` and `evals_test` and the prompt `assistant_instructions`; `schedule` creates the scorers `safety`, `pii_detection` and `reply_shows_an_id`; `label` and `align` create the labeling sessions and aligned judges `judge-labels-<run>`.
- `tests/conftest.py` and `scripts/test_user_token.sh`: one OAuth secret per test user and run, deleted at once.

## Versions and upgrades

Before raising a pin, read the release notes, deploy to `dev` or `demo`, and run every [workspace suite](development.md#workspace-suites).

| Component | Pinned at | Where | Upgrade check |
| :--- | :--- | :--- | :--- |
| Agent Bricks CLI and runtime (`databricks-agentbricks[openai]`), kept at one version | 0.5.0 | `.github/workflows/deploy.yml`, `app/pyproject.toml` | `agentbricks deploy --help` still has `--source`, `--workspace-path`, `--instances` and `--pip-index-url`; a deploy keeps the app resources it doesn't manage; the workspace suites pass |
| Apps user authorization scopes | `ai-gateway`, `sql` | `[auth.user]` in `app/agent.toml` | `tests/e2e` still sees a request without a user token refused |
| The `model_services` bundle resource, `databricks workspace-iam-v2` and the SDK's `workspace_iam_v2` | Databricks CLI 1.20.0 (the floor in `databricks.yml`), `databricks-sdk==0.150.0` | `databricks_cli_version` in `databricks.yml`, `databricks/setup-cli` in the workflows, `scripts/setup_identities.sh`, `demo/add_demo_users.sh`, `tests/conftest.py`, `tests/e2e/conftest.py` | `databricks bundle validate --strict` passes, the rate limits and grants deploy unchanged, and `scripts/setup_identities.sh` runs twice without errors |
| MLflow GenAI evaluation: datasets, the prompt registry (Beta), scheduled scorers, `PIIDetection`, `RegexMatch`, `ConversationSimulator`, judge alignment | `mlflow==3.17.0`; `databricks-agents` 1.12.0 through the lock | `app/pyproject.toml`, `evals/` | The unit tests pass, and `python -m evals run --split dev --k 1` logs a dataset, a prompt version and assessments |
| Unity Gateway guardrails (service policies) | Beta, in the UI | [evaluation.md#guardrails](evaluation.md#guardrails) | The guardrail cases pass after a `databricks bundle deploy` |

`uv run --package app` also puts the runtime's `agentbricks` command in `.venv`.

In an older deployment, whose schemas a `schema` job created, bind each schema once before the next deploy: `databricks bundle deployment bind <data|reference|ops|eval> <catalog>.<project>_<kind>`.

## Rollback

Databricks Apps has no rollback action. Deploy the last good release again:

1. Find its tag: `git tag --sort=-creatordate`.
2. Run the Deploy workflow on that tag in GitHub Actions. By hand: `git checkout <tag>`, then [Deploy a change](#deploy-a-change), as the deploy service principal in `staging` and `prod`.
3. A schema change doesn't roll back with the code. If the bad release ran a migration, [restore the affected tables](runbook.md#recovery) before the old code runs against them.

## Decommission

`make destroy TARGET=<target>` runs `scripts/destroy.sh`, which removes a deployment. It refuses the targets in production mode, `staging` and `prod`, whose state is in their deploy service principal's folder. It stops before any change while a resource has `prevent_destroy`, and names the files: remove `prevent_destroy: true` from the [protected resources](#protected-resources) for that run. A target override can't turn it off. Each step skips what is already gone, so a failed run can be run again.

It deletes only the service principals `scripts/setup_identities.sh` created for the target, which the setup lists in `.databricks/bundle/<target>/created-service-principals`, and removes their IDs from the overrides file. It keeps the account groups and their grants: account groups are account-wide, so other targets of the project or your identity provider may use them. Once none does, remove them as in steps 1 and 6.

For `staging` and `prod`, run the steps by hand as the deploy service principal:

1. Revoke what the catalog grants the app's service principal (`USE_CATALOG`, and what Apps telemetry export added), the data owner, the test service principals, and the five groups once no other target uses them: list them with `databricks grants get catalog <catalog>`, and remove each with `databricks grants update`.
2. The app and its runtime store: `agentbricks deployments delete agent-bricks-<project>`.
3. The session store: `agentbricks sessions stores delete <session store>`, the `[session_store]` name in `app/agent.toml`.
4. The app's source: `databricks workspace delete --recursive <root_path>/app`, with `<root_path>` from `databricks bundle validate -o json | jq -r .workspace.root_path`.
5. The bundle's resources: `databricks bundle destroy`.
6. The service principals the setup script created, and the groups once no other target uses them: `databricks workspace-iam-v2 delete-service-principal-proxy <service principal ID>` and `databricks workspace-iam-v2 delete-group-proxy <group ID>`.
