# Django on Databricks Apps

This template deploys a Django application on [Databricks Apps](https://www.databricks.com/product/databricks-apps) with [Lakebase Autoscaling](https://docs.databricks.com/aws/en/oltp/projects/) as the PostgreSQL backend. It stays close to standard Django, adding code only where necessary to interface with Lakebase.

## Project structure

```
databricks.yml            # Databricks Asset Bundle: Lakebase project, branch, and app
app.yaml                  # Databricks Apps runtime configuration
entrypoint.sh             # Startup script: collectstatic, ensure_schema, migrate, gunicorn
config/settings.py        # Django settings (database, CSRF, static files)
config/auth.py            # Databricks Apps user authentication (X-Forwarded-Email)
config/test_auth.py       # Tests for the authentication logic
config/test_settings.py   # Test settings: in-memory SQLite instead of Lakebase
lakebase/base.py          # Custom DB backend: injects OAuth tokens via Databricks SDK
todos/                    # Sample Django app (CRUD todo list)
```

## Note on SECRET_KEY

The template ships with an insecure fallback `SECRET_KEY` for local development. Set a real key via the `SECRET_KEY` environment variable before deploying to production.

## Deploy to Databricks

> **This bundle creates its own Lakebase database.** Unlike the other `*-postgres-app` templates, which bind an existing database, `databricks bundle deploy` creates a new Lakebase Autoscaling project (`django`) with a `development` branch; step 3 below adds the `django_app` database to it. Keep in mind:
>
> - The project ID `django` must be unique in the workspace. Change `project_id` in `databricks.yml` if it is already taken.
> - `databricks bundle destroy` deletes the project, including all of its data.
> - To use an existing database instead, remove the `postgres_projects` and `postgres_branches` resources from `databricks.yml` and point the app's `postgres` resource (`branch`, `database`) at your existing resource paths. Alternatively, create the app from the Databricks UI, where `manifest.yaml` lets you select an existing database, as with the other templates.

### 1. Authenticate

```console
databricks auth login -p <PROFILE>
```

### 2. Deploy the bundle

```console
databricks bundle deploy -p <PROFILE> -t dev
```

This will fail on the first run because the Lakebase database does not exist yet.

### 3. Create the Lakebase database

DABs do not yet support `postgres_databases` as a resource type. Create it via the API instead.

1. Look up the role for your branch:

```console
databricks api get /api/2.0/postgres/projects/django/branches/development/roles -p <PROFILE>
```

2. Note the role `name` field, which should look something like `projects/django/branches/development/roles/rol-xxxx-xxxxxxxx`. Then, create the database:

```console
databricks api post \
  '/api/2.0/postgres/projects/django/branches/development/databases?database_id=django-app' \
  -p <PROFILE> \
  --json '{"spec": {"postgres_database": "django_app", "role": "<ROLE NAME>"}}'
```

### 4. Deploy again

```console
databricks bundle deploy -p <PROFILE> -t dev
```

### 5. Start the app

```console
databricks bundle run django_app -p <PROFILE> -t dev
```

## Deploy as a git-backed app

Instead of syncing files to a workspace folder, you can deploy directly from a Git repository. The app reads code from a Git reference (branch, tag, or commit) each time you deploy. See the [Databricks docs](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy) for full details.

### 1. Create the app and configure the Git repository

In the Databricks UI:

1. Go to **Compute → Apps** and click **Create app**.
2. In the **Configure Git repository** step, enter your repository URL (e.g. `https://github.com/org/repo`) and select the Git provider.
3. For private repositories, click **Configure Git credential** on the app details page to give the app's service principal access. Public repositories do not require a credential.
4. Click **Create app**.

Or with the CLI:

```console
databricks apps create my-app-name \
  --git-url https://github.com/org/repo \
  --git-provider github
```

### 2. Deploy from Git

In the Databricks UI:

1. On the app details page, click **Deploy** and select **From Git**.
2. Enter the **Git reference** (`main`, a tag like `v1.0.0`, or a commit SHA).
3. Select the **Reference type** (branch, tag, or commit).
4. (Optional) Set **Source code path** if the app lives in a subdirectory of the repo (e.g. `django-postgres-app/`).
5. Click **Deploy**.

Or with the CLI:

```console
databricks apps deploy my-app-name \
  --git-reference main \
  --git-reference-type branch
```

To deploy from a subdirectory, add `--source-code-path django-postgres-app/`.

### 3. Redeploy after changes

Push your changes to the Git repository, then click **Deploy** again (or re-run the CLI deploy command). Databricks pulls the latest commit from the configured reference.

> **Note:** The Lakebase database still needs to be created separately as described in the DABs deployment section above. Git-backed deployment only changes how the app source code is delivered—resource provisioning remains the same.

## Run locally

1. Look up the `host` and endpoint `name`:

```console
databricks api get /api/2.0/postgres/projects/django/branches/development/endpoints -p <PROFILE>
```

2. Start the app with `run-local`, passing connection details as environment variables.

```console
# run the app code (assuming you have a virtual environment .venv there)
PATH=".venv/bin:$PATH" databricks apps run-local -p <PROFILE> \
  --env PGENDPOINT=<ENDPOINT NAME> \
  --env PGHOST=<HOST> \
  --env PGPORT=5432 \
  --env PGUSER=<YOUR USER> \
  --env PGDATABASE=django_app \
  --env PGSSLMODE=require \
  --env DEBUG=true \
  --env DJANGO_DEV_EMAIL=<YOUR EMAIL>
```

`DJANGO_DEV_EMAIL` enables admin access during local development since the `X-Forwarded-Email` header is not present outside Databricks Apps. The authentication middleware falls back to this variable only when `DEBUG` is enabled and the header is missing; in a deployed app (`DEBUG` off) it is ignored.

## Run tests

```console
python manage.py test
```

Tests run against an in-memory SQLite database (`config/test_settings.py`), so they need no Lakebase connection or environment variables.
