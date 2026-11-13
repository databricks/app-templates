# AGENTS.md

A full-stack agent example on Databricks Apps. The app is configured with on-behalf-of-user authorization, so each agent action stays within what Unity Catalog already permits the user, and Unity Gateway governs model calls. The example use case is Bank, a fictional bank whose customers read their accounts and confirm a few changes. It lives in fixed use-case files that can be replaced and adapted for another use case (`docs/customization.md`).

## Docs

Read the doc for the area you change:

- `docs/architecture.md`: components, the read and confirm flows, invariants, design decisions and known limits.
- `docs/backend.md`: the agent's layout, run bounds, tools, displays, models, events, conversations, feedback and guardrail blocks.
- `docs/frontend.md`: the chat UI, event replay, Markdown, registry items, the build and the UI tests.
- `docs/security.md` and `docs/access.md`: identities, data handling, and every group, grant and permission.
- `docs/development.md`: setup, the local loop, checks, tests, reset, migrations and dependency changes.
- `docs/deployment.md`: required setup, configuration, deploys, CI/CD, versions and rollback.
- `docs/runbook.md`: logs, traces, alerts, capacity and recovery.
- `docs/evaluation.md`: evals, the release gate and guardrails.
- `docs/customization.md`: the use-case files.

## Rules

- Declare every resource bundles support in the bundle. Use `agentbricks deploy` only for the agent app, and the CLI only for identities and permissions bundles can't hold.
- Keep workspace values only in `.databricks/bundle/<target>/variable-overrides.json` and `app/.env`, which git ignores. Read them from configuration (`databricks bundle validate -o json`); never hardcode or commit them. CI writes the overrides file from the GitHub variables and drops empty ones, because an empty `BUNDLE_VAR_*` overrides the default. `make env` writes `app/.env` from the bundle and `app/agent.toml`; never type its values.
- The `project` variable in `use_case.yml` prefixes every workspace name (`docs/deployment.md#workspace-resources`). Keep `bundle.name` in `databricks.yml` and `deployment_name` in `app/agent.toml` equal to it, and the `[session_store]` name equal to `<project>-sessions`; `scripts/check_bundle_name.sh` stops every deploy and `make destroy` on the bundle name before any change, `scripts/deploy_agent.sh` on the other two, and `scripts/local_env.sh` on the store. Environment variables use the `APP_` prefix.
- Keep two named clients, user and app. Build the user client inside the request, fail closed without a token, and never cache it. The API routes share one app client per process.
- Take the actor from the signed-in identity, never from client input: `X-Forwarded-Email` in API routes, the user client's `current_user.me()` in the agent.
- Log with `logging.getLogger(__name__)`, one record per boundary, with the fields in `extra` (`docs/runbook.md#logs` lists the records). Never log tokens, row data, arguments, identities, or error text from the warehouse or the model.
- Users never get `MODIFY`. Writes go only through definer procedures, which check the use case's rules as the caller and take an idempotency key, so a retried confirmation runs once.
- Grant user privileges only to `app_users_group`, never to a person (`docs/security.md#app-users`).
- Give the model no free-form SQL tool, such as the managed `system.ai.dbsql` MCP server, because users hold `EXECUTE` on the write procedures (`docs/architecture.md#reads-use-fixed-queries`). Reads are fixed queries in `app/agent/tools/`. MCP servers come only from `app/agent/mcps.py` and the `agent.toml` bindings.
- Confirm a write with a propose tool and a `confirm` input on the same session, because the Agent Bricks runtime rejects pause and resume for user-authorized runs. The proposal lives only in its `confirmation_required` event (`docs/backend.md#propose-and-confirm`).
- Activity rows come only from `RequestContext.tool_event`. `app/agent/activity.py` appends them when a run ends, even after a failure, as the app's service principal, with one plain `INSERT`, never `MERGE` (`docs/security.md#audit-and-activity`).
- Keep use-case code, text and data in the files `docs/customization.md` lists. Every other file holds no use-case words, so a team can merge upstream release tags. A generic file reads a use-case value from a use-case file.
- Before you add or change a UI component, check whether assistant-ui (`@assistant-ui/react`) provides it. Install registry items with `node frontend/scripts/registry-add.mjs` (`docs/frontend.md#registry-items`).
- Ask before workspace changes, local servers, browser or end-to-end tests, pushes, or anything touching shared history.

## Check a change

Export `DATABRICKS_CONFIG_PROFILE` before any command: the bundle sets no host, so the profile picks the workspace. CI sets no profile and authenticates through the environment, which the scripts accept too. Commands use the bundle's default target unless you pass one. Run every command from the project's directory, the one with `databricks.yml`.

- Run `make check` for every change. It runs pre-commit on the project's own files, so it also works when the project sits in a monorepo, where `--all-files` would lint other projects.
- Run the unit tests with `uv run --package app pytest -c app/pyproject.toml app/tests evals/tests`, and one test with `uv run --package app pytest app/tests/runtime/test_auth.py::<test name>`. `app/tests` mirrors `app/agent` and `app/runtime`.
- Edit `frontend/src`, never `app/static/` or `app/requirements.txt`. Run `make build` to write `app/static/`, which stays committed because `agentbricks deploy` uploads with `databricks sync`, which skips git-ignored files. Then run `npm --prefix frontend run test:ui` (`docs/frontend.md#ui-tests`).
- For a change to SQL, procedures, grants or auth, also run the workspace suites in the order in `docs/development.md#workspace-suites`, after asking. They need the test users from `scripts/setup_identities.sh` and a `databricks bundle run reset_data` on the same day. Afterwards run `make reset`.
- Run the evals with `uv run --package app python -m evals run --split dev`, and state the token estimate the run prints before you start it (`docs/evaluation.md#run`). Tune the prompt on `dev` only; the release gate uses `test`.

`docs/deployment.md#cicd` lists what CI runs. The workflows in `.github/` run only from a repository's root, so they are a template for a copy of this project in its own repo. Pin every action to a full commit SHA with a version comment, and give every job `runs-on: ubuntu-latest`, a timeout and a read-only token unless it needs more.

## Deploy and commit

- For a new workspace, run `scripts/first_deploy.sh [target]` (`docs/deployment.md#first-deploy`). Every step is safe to rerun.
- For a change, run `make deploy TARGET=<target>` (`docs/deployment.md#deploy-a-change`). To remove a deployment other than `staging` and `prod`, run `make destroy TARGET=<target>` (`docs/deployment.md#decommission`). `scripts/deploy_agent.sh` is the only way to run `agentbricks deploy` here.
- Never rename a resource key in `resources/`: a new key recreates the resource.
- Never commit the env `agentbricks deploy` writes into `app/app.yaml`. `scripts/deploy_agent.sh` adds it and restores the file, and stops while `app/app.yaml` or `app/agent.toml` differs from the last commit (`docs/deployment.md#agent-app`).
- Keep test data in `tests/fixtures/` and demo data in `demo/`. `prod` gets no data (`docs/development.md#reset-test-data`).
- Use Conventional Commits with a scope, such as `fix(agent): ...`. Commit the rebuilt `app/static/` on its own, as `build(frontend): rebuild app/static for <change>`.

## Notes

### SQL

- Schema SQL runs as SQL notebook tasks, not SQL file tasks, which split procedure bodies on `;`. `resources/data/schema.job.yml` lists the files in order.
- The SQL files grant only on tables, functions and procedures. Schema-level grants live in the `*.schema.yml` files, and a deploy removes every other one.
- Take names from the `project` job parameter: `IDENTIFIER(:project || '_data.<table>')` in statements, and string concatenation in `EXECUTE IMMEDIATE` grants and functions. A procedure body can't use parameters, so `sql/data/procedures.sql` fills in `{data}` and `{ops}` with `EXECUTE IMMEDIATE replace(...)`.
- Run `USE CATALOG` and `USE SCHEMA` as separate statements before `CREATE FUNCTION` or `CREATE PROCEDURE`. Procedures store their creation schema.
- Never give a procedure parameter a column's name. Inside a query, the column wins.
- `<project>_ops.action_audit` is append-only. Clear it by unsetting `delta.appendOnly`, deleting and setting it again; never drop and recreate it, which loses its grants.
- Add a migration as one guarded cell in `sql/data/migrations.sql` (`docs/development.md#schema-migrations`).
- Scripts and tests read the ops schema's name from `resources.schemas.ops`, because `databricks bundle validate` leaves references to other resources unresolved.

### Python and Apps

- The repo has one uv workspace, with the agent app (`app`) as its only member. `uv run --package app` syncs the app into `.venv`, and the root's `uv run --exact` removes it again.
- `uv.lock` names PyPI. Behind a package mirror, export `UV_FROZEN=1`, or every `uv run` re-locks against the mirror (`docs/development.md#dependency-changes`). The 7-day `exclude-newer` cooldown lives in the root `pyproject.toml`, because uv ignores it in a workspace member.
- Apps installs `app/requirements.txt` with pip and never sees `uv.lock`. Declare every package `app/agent` and `app/runtime` import in `app/pyproject.toml`, pinned with `==`, with no `workspace = true` sources (`docs/development.md#dependency-changes`).
- The shipped lockfiles, `uv.lock`, `app/requirements.txt` and `frontend/package-lock.json`, name only public hosts. The `public-package-hosts` hook stops a commit that names another package host.
- Start the agent server from `app/`, where the runtime finds `agent.toml`; without it, every invocation is refused. `make dev` runs `make env`, then the reload loop (`docs/development.md#local-loop`).
- Locally both clients use your CLI profile, so the reads only the app's service principal may make and the Activity write fail. Check the app's service principal on the deployed app.

### Agent and UI

- Trace tests run the real `run_agent` on a streaming mock model and a local MLflow store, with the fixtures in `app/tests/conftest.py`. Tests that hold for any use case use its `records` read tool and `rename_record` action, and the generic UI specs mock `read_records`, `rename_record` and `archive_record`, never the use case's tools.
- Mark a tool's failed read on the Agents SDK span with `get_current_span().set_error`, because MLflow sets an SDK tool span's status from it. A tool with its own MLflow span records its error there.
- Handle every new stream event in `applyEvent` (`frontend/src/features/chat/events.ts`), never in a separate load path, so a reopened conversation shows what the live one showed (`docs/backend.md#event-stream`, `docs/frontend.md#event-replay`).
- Never time a run in the browser: the app shows the seconds in `work.done`.
- Keep each `id` in `app/agent/models.toml` in step with its model service in `resources/model/` and that service's bundle variable (`docs/backend.md#models-and-effort`).
- Keep the grounding check on every display: a display shows only numbers from reads or `calculate`, and the model does no arithmetic (`docs/backend.md#displays-and-grounding`).
- `GatewayCompletions` reads a blocked stream to its end without sending it, because MLflow exports no trace while a span is open. A refusal leaves the question's trace OK, with `app.status` `POLICY_BLOCKED` (`docs/backend.md#guardrail-blocks`).
- The procedure client retries a Delta conflict at most twice with the same key within 45 seconds, and never cancels a statement (`docs/backend.md#propose-and-confirm`).
- Stop finds a run in process memory, so the app deploys one instance (`docs/architecture.md#stop-is-an-app-route`).
- Frontend routes are hash routes, because the agent serves `static/` without a fallback page.
- Keep the Markdown safe: no images, links or raw HTML, and KaTeX with `trust: false`, pinned at 0.19.0 (`docs/frontend.md#markdown`).
- `docs/architecture.md#known-limits` and `docs/frontend.md` list the known limits.
