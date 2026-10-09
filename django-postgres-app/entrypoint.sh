#!/bin/bash
set -e
python manage.py collectstatic --noinput
python manage.py ensure_schema
python manage.py migrate --noinput
PORT="${DATABRICKS_APP_PORT:-8000}"
exec gunicorn config.wsgi:application --bind "0.0.0.0:$PORT"
