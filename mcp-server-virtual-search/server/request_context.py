"""Who is calling and where: the end user's token and the workspace/app URLs.

Databricks Apps forwards the signed-in user's OAuth token on every request (pages,
APIs, and MCP traffic) in the ``x-forwarded-access-token`` header. Every upstream
call this app makes uses that token, so results respect the caller's own Unity
Catalog grants and per-user MCP service credentials.
"""

from __future__ import annotations

import functools
import os
from collections.abc import Mapping

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import DatabricksError

USER_TOKEN_HEADER = "x-forwarded-access-token"


def running_in_databricks_apps() -> bool:
    return bool(os.environ.get("DATABRICKS_APP_NAME"))


@functools.cache
def _local_workspace_client() -> WorkspaceClient:
    # Local development only: authenticate as the developer via the Databricks CLI
    # profile (DATABRICKS_CONFIG_PROFILE) or DATABRICKS_HOST/DATABRICKS_TOKEN.
    return WorkspaceClient()


def _local_dev_token() -> str | None:
    try:
        auth = _local_workspace_client().config.authenticate().get("Authorization", "")
    except (DatabricksError, ValueError):
        return None
    return auth.removeprefix("Bearer ") or None


def user_token(headers: Mapping[str, str]) -> str | None:
    """The caller's token. Deployed apps never fall back to other credentials, so a
    request without a forwarded token acts as nobody."""
    token = headers.get(USER_TOKEN_HEADER)
    if token:
        return token
    return None if running_in_databricks_apps() else _local_dev_token()


@functools.cache
def databricks_host() -> str:
    """Workspace URL without a trailing slash, e.g. https://my-workspace.cloud.databricks.com."""
    host = os.environ.get("DATABRICKS_HOST", "") or _local_workspace_client().config.host or ""
    host = host.rstrip("/")
    return host if host.startswith("http") else f"https://{host}"


def public_app_url(headers: Mapping[str, str]) -> str | None:
    """This app's public URL. Behind the Apps proxy the Host header is the internal
    localhost:8000; the public host arrives in x-forwarded-host."""
    host = headers.get("x-forwarded-host") or headers.get("host") or ""
    if not host or host.startswith(("localhost", "127.0.0.1")):
        return None
    return f"{headers.get('x-forwarded-proto', 'https')}://{host}"
