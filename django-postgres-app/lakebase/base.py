"""
Custom Django database backend for Databricks Lakebase Autoscaling.

Extends Django's built-in PostgreSQL backend. We override the method
get_connection_params(), which injects an OAuth token generated via the
Databricks SDK. Everything else — connection handling, ORM translation,
migrations — is inherited unchanged.

Usage in settings.py:
    DATABASES = {
        "default": {
            "ENGINE": "lakebase",
            ...
        }
    }
"""

import os
import threading
import time

from databricks.sdk import WorkspaceClient
from django.db import DEFAULT_DB_ALIAS
from django.db.backends.postgresql import base as pg_base

# Refresh the token when it's within this many seconds of expiring.
_TOKEN_REFRESH_MARGIN_SECONDS = 30

# Module-level token cache shared across all DatabaseWrapper instances.
_cached_token = None
_token_expires_at = 0.0
_workspace_client = None
_client_lock = threading.Lock()
_token_lock = threading.Lock()


def _get_workspace_client():
    global _workspace_client
    if _workspace_client is not None:
        return _workspace_client
    with _client_lock:
        if _workspace_client is None:
            _workspace_client = WorkspaceClient()
        return _workspace_client


def _get_token(endpoint):
    """Return a cached OAuth token, refreshing only when near expiry."""
    global _cached_token, _token_expires_at
    if (
        _cached_token
        and time.time() < _token_expires_at - _TOKEN_REFRESH_MARGIN_SECONDS
    ):
        return _cached_token

    with _token_lock:
        # Re-check after acquiring the lock — another thread may have refreshed.
        if (
            _cached_token
            and time.time() < _token_expires_at - _TOKEN_REFRESH_MARGIN_SECONDS
        ):
            return _cached_token

        credential = _get_workspace_client().postgres.generate_database_credential(
            endpoint=endpoint
        )
        _cached_token = credential.token
        # expire_time is a protobuf Timestamp; .seconds is Unix epoch seconds.
        _token_expires_at = float(credential.expire_time.seconds)
        return _cached_token


class DatabaseWrapper(pg_base.DatabaseWrapper):
    """PostgreSQL backend that authenticates to Lakebase via OAuth."""

    def __init__(self, settings_dict, alias=DEFAULT_DB_ALIAS):
        super().__init__(settings_dict, alias)
        self._endpoint = os.environ.get("PGENDPOINT", "")

    def get_connection_params(self):
        """Inject a cached OAuth token as the connection password."""
        params = super().get_connection_params()
        params["password"] = _get_token(self._endpoint)
        return params
