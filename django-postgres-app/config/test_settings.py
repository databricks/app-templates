"""Settings for `manage.py test`: in-memory SQLite, so no Lakebase is needed."""

from .settings import *  # noqa: F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}
