# Customization

The use case lives in fixed use-case files with neutral names. The example use case that `README.md` describes fills them, and the tests cover it. To replace it with another use case, change only these files, so later upstream release tags still merge. Every other file holds no use-case words: it reads any use-case value, such as a test's question, from a Replace file.

- Edit: `AGENTS.md`, `README.md` and `app/agent.toml` mix use case and generic parts. Change only the part named below; resolve them by hand on an upstream merge.
- Replace: every other file below holds only the use case. Rewrite it, keeping its name and the names other files import from it. On a merge, keep your side.
- Delete: the demo's `demo/` ([Delete the demo](#delete-the-demo)).

## Names

- `project` in `use_case.yml`, in lowercase letters and digits, prefixes every workspace name ([deployment.md](deployment.md#workspace-resources)).
- `deployment_name` in `app/agent.toml` must equal it: `agentbricks deploy` names the app from it, and `agent_app_name` defaults to `agent-bricks-<project>`.
- `bundle.name` in `databricks.yml` must equal it too: the bundle keeps its state under `.bundle/<bundle.name>/<target>`, so two projects with one bundle name in a workspace share it. `scripts/check_bundle_name.sh` stops every deploy and `make destroy` otherwise, before any change.
- The session store name, `<project>-sessions`, goes in `app/agent.toml`.
- The alerts, the operations dashboard and the model services show `display_name` from `use_case.yml`.

## Use-case files

### Root and bundle

| File | What to change |
| :--- | :--- |
| `use_case.yml` | The `project` and `display_name` defaults. |
| `AGENTS.md` | The use-case summary at the top. |
| `README.md` | The line under the title that names the example use case. |

### SQL

| File | What to change |
| :--- | :--- |
| `sql/data/tables.sql` | The use-case tables, each with an owner column for the row filter. |
| `sql/data/row_filters.sql` | `SET ROW FILTER` with `own_rows_or_backoffice` (from `audit_tables.sql`) on each use-case table. |
| `sql/data/column_masks.sql` | The mask functions and `SET MASK` statements. |
| `sql/data/procedures.sql` | The definer write procedures: check the rules as the caller, write the audit row, replay on the idempotency key. Keep the `EXECUTE IMMEDIATE replace(...)` form and the `{data}` and `{ops}` placeholders. |
| `sql/data/tool_functions.sql` | Unity Catalog functions you bind as tools in `app/agent.toml`. Empty in the example. |
| `sql/data/migrations.sql` | One guarded cell per migration ([Schema migrations](development.md#schema-migrations)). Empty in the example. |
| `sql/data/user_grants.sql` | `SELECT` on your tables and `EXECUTE` on your procedures for `app_users_group`, never `MODIFY`. |
| `sql/app/reference_grants.sql` | `SELECT` on the reference tables the app's service principal reads. |
| `tests/fixtures/test_data.sql` | The test users' rows, the reference rows and the seeded Activity, whose IDs `tests/e2e/use_case.py` names. Keep clearing your write tables; `clear_audit_tables.sql` clears the audit and Activity ones. |

### Agent and runtime

| File | What to change |
| :--- | :--- |
| `app/agent/prompts/system.md` | The system prompt: role, rules, data notes, source markers, the Markdown subset, when to use each display tool, LaTeX and Mermaid. |
| `app/agent/prompts/step.md` | The description of every tool's `Step` argument: what the step line says, and never shows. |
| `app/agent/tools/user_data.py` | Read tools over the user's filtered, masked data, on behalf of the user. |
| `app/agent/tools/reference_data.py` | Read tools over shared reference data, as the app's service principal. |
| `app/agent/tools/actions.py` | The propose tools, one per write, and `ACTIONS`: each action's procedure, parameters and done text. |
| `app/agent/mcps.py` | MCP servers the agent builds itself. Empty in the example. Never a free-form SQL server. |
| `app/agent.toml` | The deployment and session store names, and any MCP or function tool bindings. |
| `app/runtime/routers/user_data.py` | The endpoints behind the user data page, read on behalf of the user. |
| `app/runtime/routers/reference_data.py` | The endpoints behind the reference data page, read as the app's service principal. |
| `app/tests/agent/tools/test_actions.py` | Each write tool's rules match its procedure. |
| `app/tests/agent/tools/test_user_data.py` | The user reads run fixed queries on behalf of the user. |
| `app/tests/agent/tools/test_reference_data.py` | The reference reads run as the app's service principal and report refusals. |
| `app/tests/runtime/routers/test_user_data.py` | The user data endpoints read on behalf of the user. |
| `app/tests/runtime/routers/test_reference_data.py` | The reference endpoints read as the app's service principal. |

### Frontend

| File | What to change |
| :--- | :--- |
| `frontend/public/favicon.svg` | The brand icon. |
| `frontend/src/config/brand.tsx` | The product name, support name and brand mark. |
| `frontend/src/config/brand.css` | Theme token overrides for `globals.css`, such as brand colors. Empty in the example. |
| `frontend/src/config/icons.tsx` | Icons your pages, actions and read tools name, beyond the generic set in `components/icons.tsx`. |
| `frontend/src/config/pages.ts` | The pages: route, nav label, icon, component and the data each loads. Keep `usePageData(confirmedChanges: number)`: the app passes the count of changes this tab confirmed, which the example passes to `useLoaded` so its data reloads after each. |
| `frontend/src/config/actions.ts` | Each action's approval card text, field labels and value formatting. |
| `frontend/src/config/tools.ts` | The Activity labels per tool and data source, which also title an answer's sources, and the identity labels. |
| `frontend/src/config/suggestions.ts` | The starter prompts, which the guardrail notice offers too, the composer placeholder, and `mentionItems`, what `@` offers from card data. |
| `frontend/src/features/user-data/` | The user data page and its requests. |
| `frontend/src/features/reference-data/` | The reference data page and its requests. |
| `frontend/tests/ui/mock-data.ts` | Your pages' mocked responses, the read tool a mocked step names, and the Activity run. The generic specs mock `rename_record` and `archive_record` test actions instead of yours. |
| `frontend/tests/ui/pages.spec.ts` | Your pages render, navigate, work from the keyboard and wrap long names. |
| `frontend/tests/ui/actions.spec.ts` | Your approval cards' fields and rules. |
| `frontend/tests/e2e/chat.spec.ts` | The local run's questions and a cancelled change, on the profile user's rows. |
| `frontend/tests/e2e/deployed/screens.spec.ts` | A walk through your main screens on the deployed app. |

### Evals and workspace suites

| File | What to change |
| :--- | :--- |
| `evals/cases.py` | The cases with their splits, categories, sessions to simulate and expected facts as SQL, and `IDENTIFYING_VALUES_SQL`. |
| `evals/guidelines.py` | The rules for the `Guidelines` judge, the custom judges' wording, the ID patterns and the write-action names. |
| `evals/judge_agreement.json` | Start it as `{}`, so no judge gates until `align` runs. |
| `evals/tests/test_cases.py` | The checks of your ID pattern, write actions, claim wording and judges. |
| `tests/integration/test_tables.py` | Your tables' columns and clustering. |
| `tests/integration/test_procedures.py` | Each procedure per test user: allowed, refused, replayed. |
| `tests/integration/test_user_access.py` | Row visibility and masks per test user. |
| `tests/e2e/use_case.py` | The questions, read tools, row query, write and seeded Activity IDs of the generic e2e tests. |
| `tests/e2e/test_use_case.py` | Your own routes: the user's rows only, reference data only through the app. |

## Order

Each step leaves the unit and UI tests runnable:

1. Names: `use_case.yml` and `app/agent.toml`.
2. Data: the SQL files and `tests/fixtures/test_data.sql`.
3. Agent: the read and propose tools, `ACTIONS`, the two prompts and their tests.
4. Routes and frontend: the two routers, `frontend/src/config/`, the two feature folders, the UI tests and mocks.
5. Evals: the four `evals/` files.
6. Workspace suites: the Replace files under `tests/`.
7. Demo: delete `demo/` or replace its rows.
8. Docs: `README.md` and `AGENTS.md`.

## Delete the demo

`demo/` holds the `demo` target, its user variables, its `sample_data` and `reset_data` jobs, its users' rows and `demo/add_demo_users.sh`:

```bash
git rm -r demo
```

Nothing else changes: the `demo/*.yml` include in `databricks.yml` then matches nothing, and the sync path goes with `demo/target.yml`. `staging` keeps its `reset_data` job from `tests/fixtures/test_data.yml`. No target is the default any more: pass the target to every command, or set `default: true` on one in `databricks.yml`. Delete the `demo_user_*` keys from your overrides files.

`npm --prefix frontend test` runs as your CLI user, whose rows came from `demo/sample_data.sql`: give that user rows in your own data first.

## Checks for a first use case

1. `make check`.
2. `uv run --package app pytest -c app/pyproject.toml app/tests evals/tests`.
3. `npm --prefix frontend ci && npm --prefix frontend run build`, commit `app/static/` on its own, then `npm --prefix frontend run test:ui`.
4. `git grep -il <old use-case word>` finds nothing outside the use-case files.
5. `databricks bundle validate --strict -t <target>` for every target.
6. On a staging workspace (dev has no `reset_data` job): `databricks bundle deploy`, `databricks bundle run schema` twice (the second must change nothing), `scripts/deploy_agent.sh`, `scripts/setup_identities.sh`, then `databricks bundle run reset_data`.
7. The [workspace suites](development.md#tests), then the evals' [`dev` split](evaluation.md#run).
