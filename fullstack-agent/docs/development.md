# Development

Workspace setup and deploys are in [deployment.md](deployment.md).

## Before you start

1. Install the tools in [deployment.md#prerequisites](deployment.md#prerequisites).
2. Run `export DATABRICKS_CONFIG_PROFILE=<profile>` in every terminal: the bundle names no host, so the profile picks the workspace. Run commands from the project's directory, the one with `databricks.yml`.
3. Put the workspace values in `.databricks/bundle/<target>/variable-overrides.json` ([deployment.md#configuration](deployment.md#configuration)). Scripts and tests use the default target unless you pass one. For scripts that take no target, such as `scripts/test_user_token.sh`, and for pytest and the evals, run `export DATABRICKS_BUNDLE_TARGET=<target>`. A local run needs a [first deploy](deployment.md#first-deploy).
4. Run `make env` (`TARGET=<target>` for another target), which `make dev` also runs. It writes your exported profile, the catalog, project, app warehouse ID and session store name to `app/.env` from the bundle and `app/agent.toml`, and keeps your other lines. Run it again after you change target, before `uv run start-server` or `npm --prefix frontend test`. git ignores `app/.env`.
5. If your uv config names a package mirror, run `export UV_FROZEN=1` in every terminal. Otherwise every `uv run` re-locks `uv.lock` against the mirror, and the `public-package-hosts` hook stops the commit. Change dependencies as in [Dependency changes](#dependency-changes).
6. `make install` installs the frontend's packages and Chromium and WebKit for the UI tests. uv installs the Python packages on the first `uv run`.
7. Run `uv run pre-commit install`, so every commit runs the [checks](#checks). Skip it when the project sits in a monorepo: it would hook the shared repository, whose root has no pre-commit config. Run `make check` there instead.

## Local loop

`make dev` starts two servers that reload on a change. Open http://localhost:5173.

- `make dev-server` runs uvicorn from `app/` on port 8000. A `.py` change under `app/` restarts it and ends any run in flight. The server reads the prompt files in `app/agent/prompts/` on every run and `app/agent/models.toml` once.
- `make dev-frontend` runs Vite, which proxies `/api` to `127.0.0.1:8000` with `X-Forwarded-Email` set to `APP_DEV_EMAIL`, your CLI user's email, as the Apps proxy does when deployed. Every API route refuses a request without that header (401, `MCP_USER_IDENTITY_MISSING`).

`cd app && uv run start-server` serves the built `app/static/` on http://127.0.0.1:8000 without reload (`PORT` changes the port). Start it from `app/`, where the runtime finds `agent.toml`: without it every invocation is refused. It listens on `127.0.0.1` only, because it trusts `X-Forwarded-Email`.

A local run differs from the deployed app:

- Both app clients use your CLI profile. A read only the app's service principal may make, such as the reference data, is refused. The Activity write fails with one ERROR record, so Activity shows only the open tab's rows. Check what the app's service principal does on the deployed app.
- Log records are not exported; WARNING and ERROR go to stderr.
- Traces are written only when `app/.env` sets a destination (`MLFLOW_TRACKING_URI` or `MLFLOW_TRACING_DESTINATION`) and an experiment (`MLFLOW_EXPERIMENT_ID` or `MLFLOW_EXPERIMENT_NAME`).
- You see your own rows: in `demo` from `demo/sample_data.sql`; otherwise add rows for yourself to the use case's data.

## Checks

- `make check` runs pre-commit on every file git tracks in the project's directory, which in a standalone repo equals `--all-files`: ruff, shellcheck, file checks, `public-package-hosts` (a shipped lockfile names only pypi.org, files.pythonhosted.org and registry.npmjs.org) and `uv-export` (writes `app/requirements.txt` from `uv.lock`).
- `make test` runs the [unit and UI tests](#unit-and-ui-tests).
- `make build` runs `npm --prefix frontend ci` and `npm --prefix frontend run build`, which writes `app/static/` ([frontend.md#build](frontend.md#build)).

Edit `frontend/src`, never `app/static/` or `app/requirements.txt`. [CONTRIBUTING.md](../CONTRIBUTING.md#commits-and-pull-requests) has the commit rules, and [deployment.md#cicd](deployment.md#cicd) lists the pull request checks.

## Tests

### Unit and UI tests

These need no workspace.

- `uv run --package app pytest -c app/pyproject.toml app/tests evals/tests` runs the app's and the evals' unit tests. `app/tests` mirrors `app/agent` and `app/runtime`. Run one test with `uv run --package app pytest app/tests/runtime/test_auth.py::<test name>`. Tests that hold for any use case use the `records` read tool and the `rename_record` action from `app/tests/conftest.py`; the use case's own cases sit under `app/tests/agent/tools` and `app/tests/runtime/routers`.
- `npm --prefix frontend run test:ui` tests the built UI against fixtures in Chromium and WebKit ([frontend.md#ui-tests](frontend.md#ui-tests)).

### Test users

The workspace suites run as two test service principals, never as a person, except `npm --prefix frontend test`, which runs the agent locally as you.

1. `scripts/setup_identities.sh` creates them as `test_user_one_name` and `test_user_two_name` (empty in `prod`), adds them to the app users group, and writes their application IDs to `test_user_one_id` and `test_user_two_id` in the overrides file. A suite run without them stops and names the missing one.
2. `databricks bundle run reset_data` gives them their own rows from `tests/fixtures/test_data.sql`, with `owner_email` set to the application ID.
3. The script also gives each test user Consumer access (`workspace-consume`) and `CAN_USE` on the app directly. The Apps proxy applies a group change about five minutes late, and the workspace applies a lost entitlement just as late. After a rejoin, errors go on for about five more minutes. The direct grants keep the group-leave test from locking test user one out for those ten minutes, so it tests only that Unity Catalog refuses the write.
4. It also creates the eval runner, `test_user_eval_name`, in the evaluation group ([evaluation.md#setup](evaluation.md#setup)).
5. A run mints each test user's token from a one-hour secret and deletes the secret at once. pytest does this in `tests/conftest.py`, and the frontend suites do it through `scripts/test_user_token.sh one|two|eval`. Your CLI identity, their manager, only mints those secrets, changes group membership, reads grants and runs the reset jobs.

### Workspace suites

Run them in this order, in `demo` or `staging` (they need the [test users](#test-users) and `reset_data`), and stop at the first failure. Run `reset_data` on the same day: the seed dates are relative to it, and `tests/integration` checks them.

```bash
make check
make test
databricks bundle run reset_data
uv run --exact pytest tests/integration tests/e2e
npm --prefix frontend test
APP_TOKEN=$(scripts/test_user_token.sh one) npm --prefix frontend run test:deployed
```

- pytest checks what each identity can reach. `--exact` removes the app packages an earlier `uv run --package app` left in `.venv`, so a dependency missing from the root `pyproject.toml` fails.
- `npm --prefix frontend test` builds, runs `reset_data` from `frontend/tests/global-setup.ts`, starts the agent locally and runs the Playwright tests in `frontend/tests/e2e` with your email in `X-Forwarded-Email`. It runs as you: the local server uses one identity for both clients, and the session store refuses identities without workspace access, which the test users lack.
- `test:deployed` runs `reset_data`, a smoke test and a walk through the main screens in `frontend/tests/e2e/deployed` against the deployed app, with test user one's token as a bearer header.
- The evals follow, on their own token budget: [evaluation.md#run](evaluation.md#run).

Every suite stops while a test user holds `ALL_PRIVILEGES`, `MODIFY` or catalog-wide `EXECUTE`. `npm --prefix frontend test` also stops while you hold `ALL_PRIVILEGES` or `MODIFY` on the catalog. Keep only `MANAGE` and `USE_CATALOG`:

```bash
databricks grants update catalog <catalog> --json '{"changes":[{"principal":"<you>","remove":["ALL_PRIVILEGES"],"add":["MANAGE","USE_CATALOG"]}]}'
```

The suites take test user one out of the app users group and put it back, also on a failure. A killed process can't, so pytest first checks that both test users are direct members, and otherwise stops with "Run scripts/setup_identities.sh, then the tests again."

The last three suites add conversations, and pytest and `test:deployed` also write through the use case's procedures. [Reset](#reset-test-data) afterwards.

## Reset test data

`make reset TARGET=<target>` runs both steps, on the default target without `TARGET`.

- `databricks bundle run reset_data` empties the audit and Activity tables (`tests/fixtures/clear_audit_tables.sql`), then rewrites the test data from `tests/fixtures/test_data.sql`: the test users' rows, the reference rows and the seeded Activity. It also clears the tables the use case's procedures write. In `demo` it then loads `demo/sample_data.sql`. Only `staging` and `demo` have the job.
- `scripts/clear_conversations.sh` deletes every stored conversation of your CLI user and both test users, deployed and local, about one a second. It takes no target: it always reads the default target's test users.

## Schema migrations

The `schema` job runs `sql/data/migrations.sql` on every deploy, after the tool functions and before the grants, so a new migration needs no job change.

1. Append a cell after a `-- COMMAND ----------` line, with an `IF NOT EXISTS` guard on `information_schema.columns` for the column it adds, wrapped in `BEGIN ... END`. An idempotent statement, such as `ALTER TABLE ... CLUSTER BY`, needs no guard.
2. Add the column to the expected set in `tests/integration/test_tables.py`.
3. Run `databricks bundle run schema` twice: the first run adds the column, the second shows the guard skips it.

`schema` recreates the procedures, which drops their `EXECUTE` grants; its `user_grants` task grants them again. A migration doesn't [roll back](deployment.md#rollback) with the code.

## Dependency changes

- Python: edit `app/pyproject.toml`, pinned with `==`, run `uv lock`, and commit both with the `app/requirements.txt` the `uv-export` hook rewrites. Declare there every package `app/agent` and `app/runtime` import, with no `workspace = true` sources: Apps installs `app/requirements.txt` with pip and never sees `uv.lock`. Packages only the workspace suites use go in the root `pyproject.toml`'s `dev` group. Apps installs from `pip_index_url` when it is set. The root `pyproject.toml` sets `exclude-newer = "7 days"`, so uv locks no release younger than a week. If your uv config names a mirror that keeps PyPI's paths, run `UV_FROZEN=0 uv lock`, then point the lock back at PyPI before you commit: `perl -pi -e 's#<index>/simple#https://pypi.org/simple#g; s#<index>/packages/#https://files.pythonhosted.org/packages/#g' uv.lock`, with `<index>` your index URL without `/simple`.
- Frontend: `npm --prefix frontend install <package>@<version> --save-exact`. If your npm registry is a private mirror, point the lock back at the public one before you commit: `perl -pi -e 's#<registry>#https://registry.npmjs.org/#g' frontend/package-lock.json`, with `<registry>` the URL `npm config get registry` prints, ending in `/`. npm maps it back to your registry on install.
- Registry items: [frontend.md#registry-items](frontend.md#registry-items).
- After a Python dependency change, deploy, then `databricks apps stop agent-bricks-<project>` and `databricks apps start agent-bricks-<project>`, so the app installs `app/requirements.txt` on fresh compute, and check the start's deployment with `databricks apps get agent-bricks-<project>`: the logs show no pip output. A redeploy to running compute reuses the installed packages without a hash check, so a bad file passes the deploy and keeps the app down from the next restart until a fixed deploy.
