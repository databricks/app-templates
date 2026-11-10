import os

from psycopg.sql import Identifier


def get_schema_name():
    """Build schema name following Databricks Apps convention."""
    pgappname = os.environ.get("PGAPPNAME", "my_app")
    pguser = os.environ.get("PGUSER", "").replace("-", "")
    return f"{pgappname}_schema_{pguser}"


def get_search_path_option():
    """libpq `options` that set search_path to the app schema, quoted like ensure_schema.

    Unquoted, Postgres would lowercase the name, so any uppercase character
    (e.g. in an email PGUSER) would point search_path at a different schema
    than the one ensure_schema creates.
    """
    return f"-c search_path={Identifier(get_schema_name()).as_string()}"
