#!/bin/bash
set -e
python manage.py collectstatic --noinput
python manage.py ensure_schema
python manage.py migrate --noinput
PORT="${DATABRICKS_APP_PORT:-8000}"
exec uvicorn config.asgi:application --host 0.0.0.0 --port "$PORT"
