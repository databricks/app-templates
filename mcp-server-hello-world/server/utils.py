import contextvars
import os

from databricks.sdk import WorkspaceClient

header_store = contextvars.ContextVar("header_store")


def get_workspace_client():
    return WorkspaceClient()


def get_user_authenticated_workspace_client():
    # Check if running in a Databricks App environment
    is_databricks_app = "DATABRICKS_APP_NAME" in os.environ

    if not is_databricks_app:
        # Running locally, use default authentication
        return WorkspaceClient()

    # Running in Databricks App, require user authentication token
    headers = header_store.get({})
    token = headers.get("x-forwarded-access-token")

    if not token:
        raise ValueError(
            "Authentication token not found in request headers (x-forwarded-access-token). "
        )

    return WorkspaceClient(token=token, auth_type="pat")
