# Django on Databricks Apps

A template for deploying Django applications on [Databricks Apps](https://www.databricks.com/product/databricks-apps) with [Lakebase Autoscaling](https://docs.databricks.com/aws/en/oltp/projects/) as the PostgreSQL backend. It stays close to standard Django, adding code only where necessary to interface with Lakebase.

## Project structure

```
databricks.yml              # Databricks Asset Bundle: Lakebase project, branch, and app
django-postgres-app/
  app.yaml                  # Databricks Apps runtime configuration
  entrypoint.sh             # Startup script: collectstatic, migrate, uvicorn
  config/settings.py        # Django settings (database, CSRF, static files)
  lakebase/base.py          # Custom DB backend: injects OAuth tokens via Databricks SDK
  todos/                    # Sample Django app (CRUD todo list)
```

## Note on SECRET_KEY

The template ships with an insecure fallback `SECRET_KEY` for local development. Set a real key via the `SECRET_KEY` environment variable before deploying to production.

## Deploy to Databricks

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

1. Note the role `name` field, which should look something like `projects/django/branches/development/roles/rol-xxxx-xxxxxxxx`. Then, create the database:

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

## Run locally

1. Look up the `host` and endpoint `name`:

```console
databricks api get /api/2.0/postgres/projects/django/branches/development/endpoints -p <PROFILE>
```

2. Navigate to the app directory and start the app with `run-local`, passing connection details as environment variables.

```console
# change directory
cd django-postgres-app

# run the app code (assuming you have a virtual environment .venv there)
PATH=".venv/bin:$PATH" databricks apps run-local -p <PROFILE> \
  --env PGENDPOINT=<ENDPOINT NAME> \
  --env PGHOST=<HOST> \
  --env PGPORT=5432 \
  --env PGUSER=<YOUR USER> \
  --env PGDATABASE=django_app \
  --env PGSSLMODE=require \
  --env DJANGO_DEV_EMAIL=<YOUR EMAIL>
```

`DJANGO_DEV_EMAIL` enables admin access during local development since the `X-Forwarded-Email` header is not present outside Databricks Apps. The authentication middleware falls back to this variable when set.