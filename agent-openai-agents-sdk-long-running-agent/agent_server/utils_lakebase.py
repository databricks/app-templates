"""Lakebase utilities for instance name resolution.

When running in Databricks Apps, LAKEBASE_INSTANCE_NAME may be a hostname
(from valueFrom: "database") rather than an instance name. resolve_lakebase_instance_name
resolves hostnames to instance names.
"""

import logging
from typing import Optional

from databricks.sdk import WorkspaceClient

logger = logging.getLogger(__name__)


def _is_lakebase_hostname(value: str) -> bool:
    """Check if the value looks like a Lakebase hostname rather than an instance name."""
    return ".database." in value and value.endswith(".com")


def resolve_lakebase_instance_name(
    instance_name: str, workspace_client: Optional[WorkspaceClient] = None
) -> str:
    """
    Resolve a Lakebase instance name from a hostname if needed.

    If the input is a hostname (e.g., from Databricks Apps valueFrom resolution),
    this will resolve it to the actual instance name by listing database instances.

    Args:
        instance_name: Either an instance name or a hostname
        workspace_client: Optional WorkspaceClient to use for resolution

    Returns:
        The resolved instance name

    Raises:
        ValueError: If the hostname cannot be resolved to an instance name
    """
    if not _is_lakebase_hostname(instance_name):
        return instance_name

    client = workspace_client or WorkspaceClient()
    hostname = instance_name

    try:
        instances = list(client.database.list_database_instances())
    except Exception as exc:
        raise ValueError(
            f"Unable to list database instances to resolve hostname '{hostname}'. "
            "Ensure you have access to database instances."
        ) from exc

    for instance in instances:
        rw_dns = getattr(instance, "read_write_dns", None)
        ro_dns = getattr(instance, "read_only_dns", None)
        if hostname in (rw_dns, ro_dns):
            resolved_name = getattr(instance, "name", None)
            if not resolved_name:
                raise ValueError(
                    f"Found matching instance for hostname '{hostname}' "
                    "but instance name is not available."
                )
            logger.info(
                "Resolved Lakebase hostname '%s' to instance name '%s'",
                hostname,
                resolved_name,
            )
            return resolved_name

    raise ValueError(
        f"Unable to find database instance matching hostname '{hostname}'. "
        "Ensure the hostname is correct and the instance exists."
    )
