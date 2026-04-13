"""
Django settings for the Databricks Apps + Lakebase.

The only Databricks-specific configuration here is the database ENGINE
("lakebase") which handles OAuth token injection transparently.
Everything else is standard Django.
"""

import os
from pathlib import Path

from utils import get_schema_name

BASE_DIR = Path(__file__).resolve().parent.parent

# Security
# WARNING: Set a real SECRET_KEY via environment variable in production.
# The fallback below is only safe for local development.
SECRET_KEY = os.environ.get(
    "SECRET_KEY",
    "django-insecure-change-me-in-production",
)
DEBUG = os.environ.get("DEBUG", "False") == "True"
# Databricks Apps run behind a reverse proxy and aren't directly exposed to the
# public internet, so we accept all hosts at the Django layer. If you deploy this
# outside Databricks Apps, replace # \"*\" with your real domain(s) to re‑enable
# Django’s Host header protection.
ALLOWED_HOSTS = ["*"]


# CSRF: Required for POST requests over HTTPS (Django 4.0+).
#
# Browsers send Origin/Referer for the app's *public* URL on *.databricksapps.com,
# not the workspace host in DATABRICKS_HOST (e.g. adb-....azuredatabricks.net).
# Wildcard entries match subdomains per Django's CSRF docs.
# Optional: set DJANGO_CSRF_TRUSTED_ORIGINS="https://a.com,https://b.com" for extras.
def _csrf_trusted_origins():
    origins = []
    raw = os.environ.get("DATABRICKS_HOST", "").strip().rstrip("/")
    if raw:
        if not raw.startswith(("http://", "https://")):
            raw = f"https://{raw}"
        origins.append(raw)
    extra = os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "")
    for part in extra.split(","):
        part = part.strip().rstrip("/")
        if part and part not in origins:
            origins.append(part)
    for pattern in (
        "https://*.databricksapps.com",
        "https://*.cloud.databricksapps.com",
    ):
        if pattern not in origins:
            origins.append(pattern)
    return origins


CSRF_TRUSTED_ORIGINS = _csrf_trusted_origins()

SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# Application definition
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "todos",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "config.auth.DatabricksAppsMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

AUTHENTICATION_BACKENDS = [
    "config.auth.DatabricksAppsBackend",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

ASGI_APPLICATION = "config.asgi.application"


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases
#
# The "lakebase" engine extends Django's PostgreSQL backend to inject
# OAuth tokens via the Databricks SDK. No password is needed in settings.


DATABASES = {
    "default": {
        "ENGINE": "lakebase",
        "NAME": os.environ.get("PGDATABASE", ""),
        "USER": os.environ.get("PGUSER", ""),
        "HOST": os.environ.get("PGHOST", ""),
        "PORT": os.environ.get("PGPORT", ""),
        "OPTIONS": {
            "sslmode": os.environ.get("PGSSLMODE", "require"),
            "options": f"-c search_path={get_schema_name()}",
        },
        "CONN_MAX_AGE": 600,
        "CONN_HEALTH_CHECKS": True,
    }
}

# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Default primary key field type
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
