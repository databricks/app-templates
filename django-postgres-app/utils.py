import os


def get_schema_name():
    """Build schema name following Databricks Apps convention."""
    pgappname = os.environ.get("PGAPPNAME", "my_app")
    pguser = os.environ.get("PGUSER", "").replace("-", "")
    return f"{pgappname}_schema_{pguser}"
