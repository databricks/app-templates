# Contributing

Thanks for helping improve the Databricks App templates. This guide covers how the repo is organized, what a template PR needs, and how to test a template end to end in **your own** Databricks workspace.

## How the repo is organized

Each top-level directory is a standalone template that users copy as-is, so a template must not import from outside its own directory.

Some files are shared across templates. **Never edit the copies inside a template.** Edit the source, then run the sync:

| Source | Sync command | What it syncs |
|---|---|---|
| `.scripts/source/` | `uv run python .scripts/sync-scripts.py` | Agent scripts (`quickstart.py`, `start_app.py`, …), `app_diagnostics.py` / `diagnostics.ts`, the agents' `deploy.yml` workflow, and `constraints.txt` into every Python template |
| `.claude/skills/` | `uv run python .scripts/sync-skills.py` | Skill directories under each agent template's `.claude/skills/` |

The `sync-check` CI job re-runs both syncs and fails if anything changes. If it fails on your PR, run the two commands above and commit the result.

## Adding or changing a template

- **Agent templates** (directories named `agent-*`) are registered in `.scripts/templates.py`. Add your template there, then run both syncs. See [`.claude/AGENTS.md`](.claude/AGENTS.md) for the handler, tracing and `databricks.yml` conventions.
- **Every template** needs an `app.yaml`, a `manifest.yaml`, a row in the [README](README.md) table, and an entry in [`.scripts/agent-integration-tests/validation-config.yaml`](.scripts/agent-integration-tests/validation-config.yaml) so the test harness can deploy it (see [Testing](#testing-a-template-in-your-own-workspace)).
- **Resources** (serving endpoint, SQL warehouse, Lakebase, …) are referenced in `app.yaml` with `valueFrom: <resource-key>`. Use the same keys as similar templates (`serving-endpoint`, `sql-warehouse`, `postgres`, `experiment`, …) and no workspace-specific IDs or URLs; use placeholders that `quickstart` or the user fills in.

### Dependencies

- **Python:**
  - `requirements.txt` templates pin with `~=` or `==`.
  - Agent `pyproject.toml` files set `[tool.uv] exclude-newer = "7 days"`, a dependency cooldown.
  - Don't commit `uv.lock` (it's gitignored).
  - The sync adds `-c constraints.txt` (or a `[tool.uv] constraint-dependencies` block), which keeps known-vulnerable transitive versions out. To deny-list another version, edit `.scripts/source/constraints.txt` and re-run the sync.
- **npm:**
  - `package.json` dependencies use exact versions.
  - Commit `package-lock.json`, and make sure every `resolved` URL points at `https://registry.npmjs.org/`, not a private mirror.
  - Only use versions published at least 7 days ago.
- **Security:** Databricks Apps runs semgrep (community rules) against deployed source, so templates must scan cleanly. Prefer real fixes. For a genuine false positive, add `# nosemgrep: <rule-id>` with a short reason. Pin GitHub Actions to commit SHAs.

## Testing a template in your own workspace

The test harness lives in `.scripts/agent-integration-tests/`. It needs [uv](https://docs.astral.sh/uv/) and the [Databricks CLI](https://docs.databricks.com/aws/en/dev-tools/cli/), authenticated to a workspace where you can create apps:

```bash
databricks auth login --host https://<your-workspace-url> --profile my-ws
cd .scripts/agent-integration-tests
uv sync
```

Use your **workspace URL** as the host. If your profile points at a unified login host (it has `account_id` and `workspace_id`), requests from locally running agents to model serving get redirected to the login page.

### Agent templates: `test_e2e.py`

For `agent-*` templates, `test_e2e.py` does the whole lifecycle: quickstart, a local server, a deployed app, the endpoint checks, and teardown.

```bash
# Local + deploy (creates the app, queries it, then runs `bundle destroy`)
uv run pytest test_e2e.py -v --template <agent-template> --profile my-ws

# Lakebase-backed templates (*-advanced) also need an autoscaling endpoint
uv run pytest test_e2e.py -v --template agent-langgraph-advanced --profile my-ws \
  --lakebase-autoscaling-endpoint projects/<project>/branches/<branch>/endpoints/<endpoint>

# Local only, or keep the deployed app for inspection
uv run pytest test_e2e.py -v --template <agent-template> --profile my-ws --skip-deploy
uv run pytest test_e2e.py -v --template <agent-template> --profile my-ws --no-destroy
```

The deploy phase creates the app from the template's `databricks.yml` and runs `databricks bundle destroy` when it finishes. If you used `--no-destroy`, clean up with `databricks bundle destroy` from the template directory. Per-template logs are in `logs/<template>.log`.

### Any template: `validate_templates.py`

`validate_templates.py` deploys a template's source into one long-lived app and checks that it serves. Depending on the template's `verify` mode, it checks the rendered page, the built JS/CSS, or a non-5xx response. This works for every template, including non-agent ones.

**1. Create a test app and bind the resources your template uses.**

```bash
databricks apps create my-template-test --profile my-ws
```

Then, in the workspace UI, open the app, choose **Edit → App resources**, and add a resource for each `valueFrom` key in your template's `app.yaml`, using the same **resource key**. For example, add a serving endpoint with key `serving-endpoint` and **Can query**, or a Lakebase database with key `postgres`. Templates without resources need nothing.

On-behalf-of-user templates (`*-obo-user`, `verify: obo`) also need user authorization scopes. Those are fixed **when the app is created**, so create it with the scopes the template needs instead of adding them later.

**2. Point the harness at your app.** Copy the config and change the two workspace-specific fields:

```bash
cp validation-config.yaml my-validation-config.yaml
# edit:  profile: my-ws
#        shared_app_name: my-template-test
```

**3. Save a browser session.** `html`, `spa` and `obo` checks load the app in a browser, and deployed apps sit behind SSO. Log in once; the session lasts about a day:

```bash
uv run playwright install chromium
uv run python auth_setup.py "$(databricks apps get my-template-test -p my-ws -o json | python3 -c 'import json,sys;print(json.load(sys.stdin)["url"])')" .auth/my-ws.json
```

`validate_templates.py` reads the session from `.auth/<profile>.json`.

**4. Deploy and verify one template.**

```bash
DATABRICKS_CONFIG_PROFILE=my-ws uv run pytest validate_templates.py -p no:xdist -v \
  --config my-validation-config.yaml --val-template <your-template> -k test_validate_template
```

The harness uploads the template to `/Workspace/Users/<you>/template-validation/<your-template>`, runs `databricks apps deploy` into your app, waits for it to run, and checks it. Always pass `-p no:xdist`, because every template deploys into the same app. The results are in `logs/validate-<your-template>.log` and `logs/validation-report.md`.

- For dependency-only changes to npm templates, `--val-force-build` runs a clean `npm ci` and `npm run build` instead of deploying.
- A failure reading **"app redirected to SSO login"** means the browser session expired: re-run step 3.

**5. Tear down** when you're done. The app is meant to persist between runs, so the harness doesn't delete it.

```bash
databricks apps delete my-template-test --profile my-ws
databricks workspace delete --recursive \
  "/Workspace/Users/<you>/template-validation/<your-template>" --profile my-ws
```

## Before opening a PR

- [ ] Both syncs run, and their output is committed.
- [ ] A new template is registered (agents), and has a README row and a `validation-config.yaml` entry.
- [ ] Dependencies are pinned, past the 7-day cooldown, and the lockfiles use only public registry URLs.
- [ ] The template deploys and serves in your workspace (`test_e2e.py` or `validate_templates.py`).
- [ ] The PR description says what the template does and how you tested it.
