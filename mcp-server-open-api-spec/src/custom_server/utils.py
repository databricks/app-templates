"""Utility functions for OpenAPI spec loading and authentication"""

import contextvars
import json
import logging
import os
from typing import Any, Dict, Optional

from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)

# Context variable for headers
header_store = contextvars.ContextVar("header_store")

# Global cache for OpenAPI spec
_cached_openapi_spec: Optional[Dict[str, Any]] = None


def load_openapi_spec() -> Dict[str, Any]:
    """Load and cache the OpenAPI specification from spec.json"""
    global _cached_openapi_spec

    if _cached_openapi_spec is not None:
        return _cached_openapi_spec

    spec_volume_path = os.getenv("SPEC_VOLUME_PATH")
    spec_file_name = os.getenv("SPEC_FILE_NAME")
    if spec_volume_path is None:
        raise ValueError(
            "SPEC_VOLUME_PATH environment variable is not set. Please update the environment variable in app.yaml"
        )

    if spec_file_name is None:
        raise ValueError(
            "SPEC_FILE_NAME environment variable is not set. Please update the environment variable in app.yaml"
        )

    try:
        w = get_workspace_client()
        spec_file = w.files.download(f"{spec_volume_path}/{spec_file_name}").contents
        file_data = spec_file.read().decode("utf-8")
        _cached_openapi_spec = json.loads(file_data)
        logger.info("Successfully loaded OpenAPI specification")
        return _cached_openapi_spec
    except Exception as e:
        logger.error(f"Failed to load OpenAPI specification: {e}")
        raise


def get_workspace_client() -> WorkspaceClient:
    """Get WorkspaceClient using profile from environment variables"""
    profile = os.getenv("DATABRICKS_CONFIG_PROFILE")
    if profile:
        return WorkspaceClient(profile=profile)
    else:
        return WorkspaceClient()


def get_user_authenticated_workspace_client() -> WorkspaceClient:
    """Get WorkspaceClient using token from headers"""
    is_databricks_app = "DATABRICKS_APP_NAME" in os.environ

    if not is_databricks_app:
        # Running locally, use default authentication
        profile = os.getenv("DATABRICKS_CONFIG_PROFILE")
        if profile:
            return WorkspaceClient(profile=profile)
        else:
            return WorkspaceClient()

    headers = header_store.get({})
    token = headers.get("x-forwarded-access-token")

    if not token:
        raise ValueError(
            "Authentication token not found in request headers (x-forwarded-access-token)"
        )

    return WorkspaceClient(token=token, auth_type="pat")


def app_setup_complete() -> bool:
    spec_volume_path = os.getenv("SPEC_VOLUME_PATH")
    spec_file_name = os.getenv("SPEC_FILE_NAME")
    uc_connection_name = os.getenv("UC_CONNECTION_NAME")

    if spec_volume_path and spec_file_name and uc_connection_name:
        return True

    return False
