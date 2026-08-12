#!/usr/bin/env python3
"""
Quickstart setup script for Databricks agent development.

NOTE: Keep this comment up to date when editing the script.

Steps:
  1. Check prerequisites — uv, Node.js (>=20.19/22.12/23), npm, Databricks CLI.
     Exit if any are missing or Node version is unsupported by Vite.
  2. Set up .env — copy .env.example → .env (or create a minimal one).
  3. Databricks auth — use --profile if provided, otherwise list existing profiles
     for interactive selection, or create a new DEFAULT profile with --host / prompt.
     Validate the profile; authenticate via OAuth if invalid. Save profile to .env.
  4. App binding (optional) — if --app-name is provided (or entered interactively),
     update databricks.yml with the app name, then fetch the app's resources via API.
     If the app has an experiment resource, use that ID instead of creating a new one.
     If the app has a postgres or database resource, build the lakebase config from it
     (and resolve the endpoint name for local dev .env via the API).
  5. MLflow experiment — provision or reuse an experiment permanently bound to a
     Unity Catalog trace location through the supported MLflow API. Persist the
     experiment, warehouse, catalog, schema, prefix, and spans table atomically.
  6. Lakebase setup — skip if already resolved from app resources (step 4).
     Otherwise: if the template requires Lakebase (has LAKEBASE_* in databricks.yml)
     or CLI flags are provided, set up via CLI args or interactive selection.
     For non-memory templates, optionally offer Lakebase for chat UI history.
     Update databricks.yml resources and env vars.
  7. Print summary with links to experiment and Lakebase.

Usage:
    uv run quickstart [OPTIONS]

Options:
    --profile NAME    Use specified Databricks profile (non-interactive)
    --host URL        Databricks workspace URL (for initial setup)
    --lakebase-autoscaling-endpoint NAME  Autoscaling Lakebase endpoint name
    --lakebase-create-new NAME  Create a new Lakebase autoscaling project with this name
    --skip-lakebase   Skip Lakebase setup (non-interactive / CI use)
    --app-name NAME   Existing Databricks app name to bind this bundle to
    --mlflow-catalog NAME       UC catalog for trace tables (default: main)
    --mlflow-schema NAME        UC schema for trace tables (default: agent_traces)
    --mlflow-table-prefix NAME  UC trace table prefix (default: agents_on_apps)
    --mlflow-warehouse-id ID    SQL warehouse for UC trace provisioning
    -h, --help        Show this help message
"""

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.scalarstring import DoubleQuotedScalarString


@dataclass(frozen=True)
class MlflowTraceConfig:
    """Provisioned MLflow experiment and immutable Unity Catalog trace location."""

    experiment_name: str
    experiment_id: str
    warehouse_id: str
    catalog_name: str
    schema_name: str
    table_prefix: str
    otel_spans_table_name: str


def _load_yml(path: Path):
    """Load a YAML file in round-trip mode (preserves comments and formatting)."""
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.indent(sequence=4, offset=2)
    with open(path) as f:
        return yaml, yaml.load(f)


def _save_yml(yaml: YAML, data, path: Path) -> None:
    """Write YAML back to file using the same loader instance (preserves formatting)."""
    with open(path, "w") as f:
        yaml.dump(data, f)


def print_header(text: str) -> None:
    """Print a section header."""
    print(f"\n{'=' * 67}")
    print(text)
    print("=" * 67)


def print_step(text: str) -> None:
    """Print a step indicator."""
    print(f"\n{text}")


def print_success(text: str) -> None:
    """Print a success message."""
    print(f"✓ {text}")


def print_error(text: str) -> None:
    """Print an error message."""
    print(f"✗ {text}", file=sys.stderr)


def print_troubleshooting_auth() -> None:
    print("\nTroubleshooting tips:")
    print("  • Ensure you have network connectivity to your Databricks workspace")
    print("  • Try running 'databricks auth login' manually to see detailed errors")
    print("  • Check that your workspace URL is correct")
    print("  • If using a browser for OAuth, ensure popups are not blocked")


def print_troubleshooting_api() -> None:
    print("\nTroubleshooting tips:")
    print("  • Your authentication token may have expired - try 'databricks auth login' to refresh")
    print("  • Verify your profile is valid with 'databricks auth profiles'")
    print("  • Check network connectivity to your Databricks workspace")


def command_exists(cmd: str) -> bool:
    """Check if a command exists in PATH."""
    return shutil.which(cmd) is not None


def run_command(
    cmd: list[str],
    capture_output: bool = True,
    check: bool = True,
    env: dict = None,
    show_output: bool = False,
) -> subprocess.CompletedProcess:
    """Run a command and return the result."""
    merged_env = {**os.environ, **(env or {})}
    if show_output:
        return subprocess.run(cmd, check=check, env=merged_env)
    return subprocess.run(
        cmd, capture_output=capture_output, text=True, check=check, env=merged_env
    )


def get_command_output(cmd: list[str], env: dict = None) -> str:
    """Run a command and return its stdout."""
    result = run_command(cmd, env=env)
    return result.stdout.strip()


def check_prerequisites() -> dict[str, bool]:
    """Check which prerequisites are installed."""
    print_step("Checking prerequisites...")

    prereqs = {
        "uv": command_exists("uv"),
        "node": command_exists("node"),
        "npm": command_exists("npm"),
        "databricks": command_exists("databricks"),
    }

    for name, installed in prereqs.items():
        if installed:
            try:
                if name == "uv":
                    version = get_command_output(["uv", "--version"])
                elif name == "node":
                    version = get_command_output(["node", "--version"])
                elif name == "npm":
                    version = get_command_output(["npm", "--version"])
                elif name == "databricks":
                    version = get_command_output(["databricks", "--version"])
                print_success(f"{name} is installed: {version}")
            except Exception:
                print_success(f"{name} is installed")
        else:
            print(f"  {name} is not installed")

    return prereqs


def check_missing_prerequisites(prereqs: dict[str, bool]) -> list[str]:
    """Return list of missing prerequisites with install instructions."""
    missing = []

    if not prereqs["uv"]:
        missing.append("uv - Install with: curl -LsSf https://astral.sh/uv/install.sh | sh")

    if not prereqs["node"] or not prereqs["npm"]:
        missing.append("Node.js 20 - Install with: nvm install 20 (or download from nodejs.org)")

    if not prereqs["databricks"]:
        if platform.system() == "Darwin":
            missing.append("Databricks CLI - Install with: brew install databricks/tap/databricks")
        else:
            missing.append(
                "Databricks CLI - Install with: curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh"
            )

    if missing:
        missing.append(
            "Note: These install commands are for Unix/macOS. For Windows, please visit the official documentation for each tool."
        )

    return missing


def check_node_version() -> str | None:
    """Check if the installed Node.js version meets Vite's requirements.

    Vite requires Node.js >=20.19, >=22.12, or >=23.
    Node 21.x is an odd-numbered release and not supported.

    Returns None if the version is OK, or an error string if not.
    """
    if not command_exists("node"):
        return None  # Missing node is handled by check_missing_prerequisites

    try:
        version_str = get_command_output(["node", "--version"])
    except Exception:
        return None

    match = re.match(r"v(\d+)\.(\d+)\.(\d+)", version_str)
    if not match:
        return None

    major, minor = int(match.group(1)), int(match.group(2))

    # Node 21.x is odd-numbered and not a Vite target
    if major == 21:
        return (
            f"Node.js {version_str} is not supported by Vite (odd-numbered release).\n"
            "  Please install Node.js 20.19+, 22.12+, or 23+.\n"
            "  Run: nvm install 22"
        )

    # Check supported version ranges
    if major == 20 and minor >= 19:
        return None
    if major == 22 and minor >= 12:
        return None
    if major >= 23:
        return None

    # Version is too old or unsupported
    if major == 20:
        return (
            f"Node.js {version_str} is too old for Vite (requires 20.19+).\n"
            f"  Your version: {version_str}\n"
            "  Run: nvm install 20  (to get latest 20.x)"
        )
    if major == 22:
        return (
            f"Node.js {version_str} is too old for Vite (requires 22.12+).\n"
            f"  Your version: {version_str}\n"
            "  Run: nvm install 22  (to get latest 22.x)"
        )

    if major < 20:
        return (
            f"Node.js {version_str} is too old for Vite (requires 20.19+).\n"
            f"  Your version: {version_str}\n"
            "  Run: nvm install 22"
        )

    return (
        f"Node.js {version_str} is not supported by Vite.\n"
        "  Vite requires Node.js 20.19+, 22.12+, or 23+.\n"
        "  Run: nvm install 22"
    )


def setup_env_file() -> None:
    """Copy .env.example to .env if it doesn't exist."""
    print_step("Setting up configuration files...")

    env_local = Path(".env")
    env_example = Path(".env.example")

    if env_local.exists():
        print("  .env already exists, skipping copy...")
    elif env_example.exists():
        shutil.copy(env_example, env_local)
        print_success("Copied .env.example to .env")
    else:
        # Create a minimal .env
        env_local.write_text(
            "# Databricks configuration\n"
            "DATABRICKS_CONFIG_PROFILE=DEFAULT\n"
            "MLFLOW_EXPERIMENT_ID=\n"
            'MLFLOW_TRACKING_URI="databricks"\n'
            'MLFLOW_REGISTRY_URI="databricks-uc"\n'
        )
        print_success("Created .env")


def update_env_file(key: str, value: str) -> None:
    """Update or add a key-value pair in .env.

    Priority: if a commented-out line (``# KEY=...``) exists, replace it
    in-place so the value stays in its original position.  Any extra active
    or commented duplicates are removed.
    """
    env_file = Path(".env")

    if not env_file.exists():
        env_file.write_text(f"{key}={value}\n")
        return

    content = env_file.read_text()

    active_pattern = rf"^{re.escape(key)}=.*$"
    commented_pattern = rf"^#\s*{re.escape(key)}=.*$"

    has_active = re.search(active_pattern, content, re.MULTILINE)
    has_commented = re.search(commented_pattern, content, re.MULTILINE)

    if has_commented:
        # Replace at the commented line's position. Remove all active and
        # commented duplicates, then insert the value where the first
        # commented line was.
        insert_pos = has_commented.start()
        content = re.sub(commented_pattern + r"\n?", "", content, flags=re.MULTILINE)
        content = re.sub(active_pattern + r"\n?", "", content, flags=re.MULTILINE)
        content = content[:insert_pos] + f"{key}={value}\n" + content[insert_pos:]
    elif has_active:
        # No commented line — replace the active line in-place
        content = re.sub(active_pattern, f"{key}={value}", content, flags=re.MULTILINE)
    else:
        # Key doesn't exist at all — append
        if not content.endswith("\n"):
            content += "\n"
        content += f"{key}={value}\n"

    env_file.write_text(content)


def get_databricks_profiles() -> list[dict]:
    """Get list of existing Databricks profiles."""
    try:
        result = run_command(["databricks", "auth", "profiles"], check=False)
        if result.returncode != 0 or not result.stdout.strip():
            return []

        lines = result.stdout.strip().split("\n")
        if len(lines) <= 1:  # Only header or empty
            return []

        # Parse the output - first line is header
        profiles = []
        for line in lines[1:]:
            if line.strip():
                # Profile name is the first column
                parts = line.split()
                if parts:
                    profiles.append(
                        {
                            "name": parts[0],
                            "line": line,
                        }
                    )

        return profiles
    except Exception:
        return []


def validate_profile(profile_name: str) -> bool:
    """Test if a Databricks profile is authenticated."""
    try:
        env = {"DATABRICKS_CONFIG_PROFILE": profile_name}
        result = run_command(
            ["databricks", "current-user", "me"],
            check=False,
            env=env,
        )
        return result.returncode == 0
    except Exception:
        return False


def authenticate_profile(profile_name: str, host: str = None) -> bool:
    """Authenticate a Databricks profile."""
    print(f"\nAuthenticating profile '{profile_name}'...")
    print("You will be prompted to log in to Databricks in your browser.\n")

    cmd = ["databricks", "auth", "login", "--profile", profile_name]
    if host:
        cmd.extend(["--host", host])

    try:
        # Run interactively so user can see browser prompt
        result = subprocess.run(cmd)
        return result.returncode == 0
    except Exception as e:
        print_error(f"Authentication failed: {e}")
        return False


def select_profile_interactive(profiles: list[dict]) -> str:
    """Let user select a profile interactively."""
    print("\nFound existing Databricks profiles:\n")

    # Print header and profiles
    for i, profile in enumerate(profiles, 1):
        print(f"  {i}) {profile['line']}")

    print()

    while True:
        choice = input("Enter the number of the profile you want to use: ").strip()
        if not choice:
            print_error("Profile selection is required")
            continue

        try:
            index = int(choice) - 1
            if 0 <= index < len(profiles):
                return profiles[index]["name"]
            else:
                print_error(f"Please choose a number between 1 and {len(profiles)}")
        except ValueError:
            print_error("Please enter a valid number")


def setup_databricks_auth(profile_arg: str = None, host_arg: str = None) -> str:
    """Set up Databricks authentication and return the profile name."""
    print_step("Setting up Databricks authentication...")

    # If profile was specified via CLI, use it directly
    if profile_arg:
        profile_name = profile_arg
        print(f"Using specified profile: {profile_name}")
    else:
        # Check for existing profiles
        profiles = get_databricks_profiles()

        if profiles:
            profile_name = select_profile_interactive(profiles)
            print(f"\nSelected profile: {profile_name}")
        else:
            # No profiles exist - need to create one
            profile_name = None

    # Validate or authenticate the profile
    if profile_name:
        if validate_profile(profile_name):
            print_success(f"Successfully validated profile '{profile_name}'")
        else:
            print(f"Profile '{profile_name}' is not authenticated.")
            if not authenticate_profile(profile_name):
                print_error(f"Failed to authenticate profile '{profile_name}'")
                print_troubleshooting_auth()
                sys.exit(1)
            print_success(f"Successfully authenticated profile '{profile_name}'")
    else:
        # Create new profile
        print("No existing profiles found. Setting up Databricks authentication...")

        if host_arg:
            host = host_arg
            print(f"Using specified host: {host}")
        else:
            host = input(
                "\nPlease enter your Databricks host URL\n(e.g., https://your-workspace.cloud.databricks.com): "
            ).strip()

            if not host:
                print_error("Databricks host is required")
                sys.exit(1)

        profile_name = "DEFAULT"
        if not authenticate_profile(profile_name, host):
            print_error("Databricks authentication failed")
            print_troubleshooting_auth()
            sys.exit(1)
        print_success(f"Successfully authenticated with Databricks")

    # Update .env with profile
    update_env_file("DATABRICKS_CONFIG_PROFILE", profile_name)
    update_env_file("MLFLOW_TRACKING_URI", f'"databricks://{profile_name}"')
    print_success(f"Databricks profile '{profile_name}' saved to .env")

    return profile_name


def get_databricks_host(profile_name: str) -> str:
    """Get the Databricks workspace host URL from the profile."""
    try:
        result = run_command(
            ["databricks", "auth", "env", "--profile", profile_name, "--output", "json"],
            check=False,
        )
        if result.returncode == 0:
            env_data = json.loads(result.stdout)
            env_vars = env_data.get("env", {})
            host = env_vars.get("DATABRICKS_HOST", "")
            return host.rstrip("/")
    except Exception:
        pass
    return ""


def get_databricks_username(profile_name: str) -> str:
    """Get the current Databricks username."""
    try:
        w = get_workspace_client(profile_name)
        if w:
            return w.current_user.me().user_name or ""
        raise RuntimeError("Could not connect to Databricks workspace")
    except Exception as e:
        print_error(f"Failed to get Databricks username: {e}")
        print_troubleshooting_api()
        sys.exit(1)


def _location_name(location: Any) -> str:
    """Return a stable display name for an MLflow trace location."""
    if location is None:
        return "<unbound>"
    values = (
        getattr(location, "catalog_name", None),
        getattr(location, "schema_name", None),
        getattr(location, "table_prefix", None),
    )
    if all(isinstance(value, str) and value for value in values):
        return ".".join(values)
    return repr(location)


def _warehouse_state(warehouse: Any) -> str:
    state = getattr(warehouse, "state", None)
    return str(getattr(state, "value", state) or "").upper()


def _resolve_mlflow_warehouse(workspace: Any, warehouse_id: str) -> str:
    if not warehouse_id:
        try:
            warehouses = list(workspace.warehouses.list())
        except Exception as error:
            raise RuntimeError(
                f"Could not list SQL warehouses for MLflow Unity Catalog tracing: {error}"
            ) from error
        state_priority = {"RUNNING": 0, "STARTING": 1, "STOPPED": 2, "STOPPING": 3}
        warehouses.sort(key=lambda item: state_priority.get(_warehouse_state(item), 99))
        warehouse_id = next(
            (
                str(getattr(warehouse, "id", "") or "")
                for warehouse in warehouses
                if getattr(warehouse, "id", None)
                and _warehouse_state(warehouse) not in {"DELETED", "DELETING"}
            ),
            "",
        )
    if not warehouse_id:
        raise RuntimeError(
            "No available SQL warehouse was found for MLflow Unity Catalog tracing. "
            "Pass --mlflow-warehouse-id or set MLFLOW_TRACING_SQL_WAREHOUSE_ID."
        )
    try:
        warehouse = workspace.warehouses.get(warehouse_id)
    except Exception as error:
        raise RuntimeError(
            f"SQL warehouse {warehouse_id!r} is unavailable: {error}"
        ) from error
    if _warehouse_state(warehouse) in {"DELETED", "DELETING"}:
        raise RuntimeError(
            f"SQL warehouse {warehouse_id!r} is unavailable "
            f"(state: {_warehouse_state(warehouse)})"
        )
    return warehouse_id


def create_or_reuse_uc_trace_experiment(
    profile_name: str,
    username: str,
    trace_config: Any,
) -> MlflowTraceConfig:
    """Create or reuse the fixed agent experiment with an immutable UC location."""
    print_step("Setting up MLflow experiment with Unity Catalog tracing...")

    workspace = get_workspace_client(profile_name)
    if not workspace:
        raise RuntimeError("Could not connect to Databricks workspace")

    warehouse_id = str(getattr(trace_config, "warehouse_id", "") or "")
    catalog_name = str(getattr(trace_config, "catalog_name", "") or "")
    schema_name = str(getattr(trace_config, "schema_name", "") or "")
    table_prefix = str(getattr(trace_config, "table_prefix", "") or "")
    for label, value in (
        ("catalog", catalog_name),
        ("schema", schema_name),
        ("table prefix", table_prefix),
    ):
        if not value:
            raise RuntimeError(f"MLflow Unity Catalog {label} cannot be empty")
    warehouse_id = _resolve_mlflow_warehouse(workspace, warehouse_id)

    # Import only after Databricks authentication has been validated so importing
    # the quickstart module itself never initializes an MLflow client/provider.
    import mlflow
    from mlflow.entities.trace_location import UnityCatalog

    tracking_uri = f"databricks://{profile_name}"
    os.environ["MLFLOW_TRACKING_URI"] = tracking_uri
    os.environ["MLFLOW_TRACING_SQL_WAREHOUSE_ID"] = warehouse_id
    mlflow.set_tracking_uri(tracking_uri)

    experiment_name = str(
        getattr(trace_config, "experiment_name", "")
        or f"/Users/{username}/agents-on-apps"
    )
    requested_location = UnityCatalog(
        catalog_name=catalog_name,
        schema_name=schema_name,
        table_prefix=table_prefix,
    )
    previous_profile = os.environ.get("DATABRICKS_CONFIG_PROFILE")
    os.environ["DATABRICKS_CONFIG_PROFILE"] = profile_name
    try:
        existing_experiment = mlflow.get_experiment_by_name(experiment_name)
        existing_location = getattr(existing_experiment, "trace_location", None)
        if existing_experiment is not None and existing_location != requested_location:
            suggested_name = f"{experiment_name}-uc"
            raise RuntimeError(
                "MLflow experiment trace locations are immutable. "
                f"Experiment: {experiment_name}; "
                f"current location: {_location_name(existing_location)}; "
                f"requested location: {_location_name(requested_location)}. "
                "Select a new experiment name before retrying, for example: "
                f"uv run quickstart --mlflow-experiment-name {suggested_name}"
            )

        # This is the only creation path. Do not replace it with the workspace
        # create_experiment API: that would silently create an ordinary experiment.
        experiment = mlflow.set_experiment(
            experiment_name=experiment_name,
            trace_location=requested_location,
        )
    finally:
        if previous_profile is None:
            os.environ.pop("DATABRICKS_CONFIG_PROFILE", None)
        else:
            os.environ["DATABRICKS_CONFIG_PROFILE"] = previous_profile
    resolved_location = getattr(experiment, "trace_location", None)
    if resolved_location != requested_location:
        raise RuntimeError(
            "MLflow did not bind the requested immutable Unity Catalog location: "
            f"experiment={experiment_name}, "
            f"current={_location_name(resolved_location)}, "
            f"requested={_location_name(requested_location)}"
        )
    experiment_id = str(getattr(experiment, "experiment_id", "") or "")
    if not experiment_id:
        raise RuntimeError(
            f"MLflow returned no experiment ID for {experiment_name!r}"
        )

    if existing_experiment is None:
        print_success(
            f"Created UC-bound experiment '{experiment_name}' (ID: {experiment_id})"
        )
    else:
        print_success(
            f"Reusing existing experiment '{experiment_name}' (ID: {experiment_id})"
        )

    spans_table = f"{catalog_name}.{schema_name}.{table_prefix}_otel_spans"
    return MlflowTraceConfig(
        experiment_name=experiment_name,
        experiment_id=experiment_id,
        warehouse_id=warehouse_id,
        catalog_name=catalog_name,
        schema_name=schema_name,
        table_prefix=table_prefix,
        otel_spans_table_name=spans_table,
    )


def check_lakebase_required() -> bool:
    """Check if databricks.yml has Lakebase (autoscaling) configuration."""
    databricks_yml = Path("databricks.yml")
    if not databricks_yml.exists():
        return False

    content = databricks_yml.read_text()
    return "LAKEBASE_AUTOSCALING_ENDPOINT" in content


def get_env_value(key: str) -> str:
    """Get a value from .env file."""
    env_file = Path(".env")
    if not env_file.exists():
        return ""

    content = env_file.read_text()
    pattern = rf"^{re.escape(key)}=(.*)$"
    match = re.search(pattern, content, re.MULTILINE)
    if match:
        return match.group(1).strip().strip('"').strip("'")
    return ""


def get_existing_lakebase_config() -> dict | None:
    """Read existing Lakebase config from .env, if any.

    Returns:
        Dict with either:
        - {"type": "autoscaling", "endpoint": str}
        - None if no Lakebase config found
    """
    endpoint = get_env_value("LAKEBASE_AUTOSCALING_ENDPOINT")
    if endpoint:
        return {"type": "autoscaling", "endpoint": endpoint}

    return None


def validate_lakebase_config(profile_name: str, config: dict) -> bool:
    """Validate that an existing Lakebase config from .env is accessible in the current workspace."""
    if config["type"] == "autoscaling":
        return (
            validate_lakebase_autoscaling_endpoint(profile_name, config["endpoint"])
            is not None
        )
    return False


def get_workspace_client(profile_name: str):
    """Create a WorkspaceClient with the given profile."""
    try:
        from databricks.sdk import WorkspaceClient

        return WorkspaceClient(profile=profile_name)
    except Exception:
        return None


def _quoted_identifier(value: str) -> str:
    return f"`{value.replace('`', '``')}`"


def _quoted_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _execute_sql(workspace: Any, warehouse_id: str, statement: str) -> Any:
    """Execute SQL and wait for a successful terminal status."""
    response = workspace.statement_execution.execute_statement(
        statement=statement,
        warehouse_id=warehouse_id,
        wait_timeout="50s",
    )
    for _ in range(120):
        status = getattr(response, "status", None)
        state = getattr(status, "state", None)
        state_value = getattr(state, "value", state)
        if state_value == "SUCCEEDED":
            return response
        if state_value in {"FAILED", "CANCELED", "CLOSED"}:
            error = getattr(status, "error", None)
            code = getattr(error, "error_code", None)
            message = getattr(error, "message", None)
            detail = ": ".join(str(value) for value in (code, message) if value)
            raise RuntimeError(
                f"SQL statement {str(state_value).lower()}: {detail or statement}"
            )
        if state_value not in {"PENDING", "RUNNING"}:
            raise RuntimeError(
                f"SQL statement returned unknown status {state_value!r}: {statement}"
            )
        statement_id = getattr(response, "statement_id", None)
        if not isinstance(statement_id, str) or not statement_id:
            raise RuntimeError(
                f"SQL statement is {str(state_value).lower()} without a statement ID"
            )
        response = workspace.statement_execution.get_statement(statement_id)
        next_state = getattr(getattr(response, "status", None), "state", None)
        if getattr(next_state, "value", next_state) in {"PENDING", "RUNNING"}:
            time.sleep(1)
    raise TimeoutError(f"SQL statement did not finish after 120 polls: {statement}")


def _discover_uc_trace_tables(
    workspace: Any, config: MlflowTraceConfig
) -> list[tuple[str, str]]:
    response = _execute_sql(
        workspace,
        config.warehouse_id,
        " ".join(
            [
                "SELECT table_name, table_type",
                f"FROM {_quoted_identifier(config.catalog_name)}.information_schema.tables",
                f"WHERE table_schema = {_quoted_string(config.schema_name)}",
                f"AND table_name LIKE {_quoted_string(f'{config.table_prefix}%')}",
                "ORDER BY table_name",
            ]
        ),
    )
    rows = getattr(getattr(response, "result", None), "data_array", None) or []
    return [
        (str(row[0]), str(row[1]).upper())
        for row in rows
        if len(row) >= 2
        and row[0] is not None
        and row[1] is not None
        and str(row[0]).startswith(config.table_prefix)
    ]


def get_existing_app(workspace: Any, app_name: str) -> Any | None:
    """Return an app, deferring only the expected pre-deploy NotFound case."""
    from databricks.sdk.errors import NotFound

    try:
        return workspace.apps.get(app_name)
    except NotFound:
        return None
    except Exception as error:
        raise RuntimeError(
            f"Could not resolve Databricks app {app_name!r}: {error}"
        ) from error


def grant_uc_trace_access_to_app(
    workspace: Any,
    app_name: str,
    trace_config: MlflowTraceConfig,
) -> None:
    """Grant an existing app service principal explicit UC trace-table access."""
    app = get_existing_app(workspace, app_name)
    if app is None:
        raise RuntimeError(
            f"Databricks app {app_name!r} does not exist; deploy it before applying "
            "the required MLflow UC trace grants"
        )
    principal = getattr(app, "service_principal_client_id", None)
    if not isinstance(principal, str) or not principal:
        raise RuntimeError(
            f"Databricks app {app_name!r} has no service-principal application ID"
        )

    trace_entities = _discover_uc_trace_tables(workspace, trace_config)
    table_names = [name for name, _table_type in trace_entities]
    expected_spans_table = f"{trace_config.table_prefix}_otel_spans"
    if expected_spans_table not in table_names:
        raise RuntimeError(
            f"Required MLflow trace table {trace_config.otel_spans_table_name} "
            f"was not found; discovered: {', '.join(table_names) or '<none>'}"
        )

    catalog = _quoted_identifier(trace_config.catalog_name)
    schema = _quoted_identifier(trace_config.schema_name)
    grantee = _quoted_identifier(principal)
    statements = [
        f"GRANT USE CATALOG ON CATALOG {catalog} TO {grantee}",
        f"GRANT USE SCHEMA ON SCHEMA {catalog}.{schema} TO {grantee}",
    ]
    for table_name, table_type in trace_entities:
        entity = f"{catalog}.{schema}.{_quoted_identifier(table_name)}"
        if table_type == "VIEW":
            statements.append(f"GRANT SELECT ON VIEW {entity} TO {grantee}")
        else:
            statements.extend(
                [
                    f"GRANT MODIFY ON TABLE {entity} TO {grantee}",
                    f"GRANT SELECT ON TABLE {entity} TO {grantee}",
                ]
            )
    for statement in statements:
        _execute_sql(workspace, trace_config.warehouse_id, statement)


def write_mlflow_trace_env_atomically(
    trace_config: MlflowTraceConfig | Any,
    env_file: Path = Path(".env"),
) -> None:
    """Persist all six MLflow trace variables with one atomic replacement."""
    values = {
        "MLFLOW_EXPERIMENT_ID": str(trace_config.experiment_id),
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID": str(trace_config.warehouse_id),
        "MLFLOW_UC_CATALOG": str(trace_config.catalog_name),
        "MLFLOW_UC_SCHEMA": str(trace_config.schema_name),
        "MLFLOW_UC_TABLE_PREFIX": str(trace_config.table_prefix),
        "MLFLOW_OTEL_SPANS_TABLE": str(trace_config.otel_spans_table_name),
    }
    content = env_file.read_text() if env_file.exists() else ""
    keys = "|".join(re.escape(key) for key in values)
    content = re.sub(
        rf"^(?:#\s*)?(?:{keys})=.*(?:\n|$)",
        "",
        content,
        flags=re.MULTILINE,
    )
    if content and not content.endswith("\n"):
        content += "\n"
    content += "".join(f"{key}={value}\n" for key, value in values.items())

    env_file.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=env_file.parent,
        prefix=f".{env_file.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        temporary.write(content)
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, env_file)


def get_app_resources(profile_name: str, app_name: str) -> list[dict]:
    """Fetch resources from an existing Databricks app.

    Returns the resources list from the apps API, or empty list on failure.
    """
    print(f"Fetching resources from app '{app_name}'...")
    result = run_command(
        ["databricks", "-p", profile_name, "apps", "get", app_name, "--output", "json"],
        check=False,
    )
    if result.returncode != 0:
        print(
            f"  Could not fetch app details: "
            f"{result.stderr.strip() if result.stderr else 'Unknown error'}"
        )
        return []
    try:
        data = json.loads(result.stdout)
        resources = data.get("resources", [])
        if resources:
            print_success(f"Found {len(resources)} resource(s) in app '{app_name}'")
        else:
            print(f"  App '{app_name}' has no resources configured")
        return resources
    except (json.JSONDecodeError, KeyError):
        return []


def create_lakebase_instance(profile_name: str, name: str = None) -> dict:
    """Create a new Lakebase autoscaling instance (project + branch).

    Args:
        name: Optional project name. If None, prompts the user via stdin.

    Returns:
        Dict with {"type": "autoscaling", "endpoint": str}
    """
    w = get_workspace_client(profile_name)
    if not w:
        print_error("Could not connect to Databricks. Check your CLI profile.")
        sys.exit(1)

    if name is None:
        name = input("Enter a name for the new Lakebase autoscaling project: ").strip()
    if not name:
        print_error("Instance name is required")
        sys.exit(1)

    print(f"\nCreating Lakebase autoscaling project '{name}'...")
    try:
        from databricks.sdk.service.postgres import Branch, BranchSpec, Project, ProjectSpec

        project_op = w.postgres.create_project(
            project=Project(spec=ProjectSpec(display_name=name)),
            project_id=name,
        )
        project = project_op.wait()
        project_short = project.name.removeprefix("projects/")
        print_success(f"Created project: {project_short}")

        # Create a default branch
        branch_id = f"{name}-branch"
        branch_op = w.postgres.create_branch(
            parent=project.name,
            branch=Branch(spec=BranchSpec(no_expiry=True)),
            branch_id=branch_id,
        )
        branch = branch_op.wait()
        branch_name = (
            branch.name.split("/branches/")[-1]
            if "/branches/" in branch.name
            else branch_id
        )
        print_success(f"Created branch: {branch_name}")

        # Fetch the endpoint info (which also resolves branch/database paths)
        endpoint_info = validate_lakebase_autoscaling_endpoint(
            profile_name,
            f"projects/{project_short}/branches/{branch_name}/endpoints/primary",
        )
        if not endpoint_info:
            print_error(
                "Could not determine endpoint name for the created Lakebase instance.\n"
                "  Please find the endpoint name in the Databricks UI and use:\n"
                f"  uv run quickstart --lakebase-autoscaling-endpoint <endpoint-name>"
            )
            sys.exit(1)

        return {
            "type": "autoscaling",
            "endpoint": endpoint_info["endpoint"],
            "host": endpoint_info["host"],
            "branch": endpoint_info["branch"],
            "database": endpoint_info["database"],
        }
    except Exception as e:
        print_error(f"Failed to create Lakebase instance: {e}")
        sys.exit(1)


def _fetch_autoscaling_endpoint_info(
    profile_name: str, project: str, branch: str
) -> tuple[str, str]:
    """Fetch endpoint info for an autoscaling Lakebase branch.

    Returns (endpoint_path, host) where:
    - endpoint_path is the full resource path (e.g. "projects/{id}/branches/{id}/endpoints/{id}")
    - host is the connection hostname (e.g. "ep-xxx.database.us-west-2.cloud.databricks.com")

    Returns ("", "") if not found.
    """
    result = run_command(
        [
            "databricks",
            "-p",
            profile_name,
            "api",
            "get",
            f"/api/2.0/postgres/projects/{project}/branches/{branch}/endpoints",
            "--output",
            "json",
        ],
        check=False,
    )
    if result.returncode == 0 and result.stdout:
        try:
            data = json.loads(result.stdout)
            endpoints = data.get("endpoints", [])
            if endpoints:
                ep = endpoints[0]
                name = ep.get("name", "")
                host = ep.get("status", {}).get("hosts", {}).get("host", "")
                return name, host
        except (json.JSONDecodeError, IndexError, KeyError):
            pass
    return "", ""


def select_lakebase_interactive(profile_name: str) -> dict:
    """Interactive Lakebase setup.

    Flow:
    1. New or existing?
    2. New -> Create autoscaling project + branch, return endpoint
    3. Existing -> ask for autoscaling endpoint

    Returns:
        Dict with {"type": "autoscaling", "endpoint": str}
    """
    print("\nLakebase Setup")
    print("  1) Create a new Lakebase instance")
    print("  2) Use an existing Lakebase instance")
    print()

    while True:
        choice = input("Enter your choice (1 or 2): ").strip()
        if choice in ("1", "2"):
            break
        print_error("Please enter 1 or 2")

    if choice == "1":
        return create_lakebase_instance(profile_name)

    # Existing autoscaling instance - ask for endpoint name
    endpoint = input("\nEnter the autoscaling Lakebase endpoint name: ").strip()
    if not endpoint:
        print_error("Endpoint name is required")
        sys.exit(1)

    return {"type": "autoscaling", "endpoint": endpoint}


def validate_lakebase_autoscaling_endpoint(profile_name: str, endpoint: str) -> dict | None:
    """Validate that the Lakebase autoscaling endpoint exists.

    Uses the postgres API to verify the endpoint, then fetches the branch and
    database paths needed for the DAB postgres resource in databricks.yml.

    Returns a dict with {"endpoint": str, "host": str, "branch": str, "database": str}
    on success, or None on failure.
    """
    print(f"Validating Lakebase autoscaling endpoint '{endpoint}'...")

    # endpoint can be a full resource path (projects/p/branches/b/endpoints/e)
    # or a legacy short name — build the API path accordingly
    if endpoint.startswith("projects/"):
        api_path = f"/api/2.0/postgres/{endpoint}"
    else:
        api_path = f"/api/2.0/postgres/endpoints/{endpoint}"

    result = run_command(
        [
            "databricks",
            "-p",
            profile_name,
            "api",
            "get",
            api_path,
            "--output",
            "json",
        ],
        check=False,
    )

    if result.returncode != 0:
        error_msg = result.stderr.lower() if result.stderr else ""
        if "not found" in error_msg or "404" in error_msg:
            print_error(f"Lakebase autoscaling endpoint '{endpoint}' not found.")
        elif "permission" in error_msg or "forbidden" in error_msg or "unauthorized" in error_msg:
            print_error(f"No permission to access Lakebase endpoint '{endpoint}'")
        else:
            print_error(
                f"Failed to validate Lakebase endpoint: {result.stderr.strip() if result.stderr else 'Unknown error'}"
            )
        return None

    print_success(f"Lakebase autoscaling endpoint '{endpoint}' validated")
    host = ""
    branch = ""
    try:
        data = json.loads(result.stdout)
        host = data.get("status", {}).get("hosts", {}).get("host", "")
        branch = data.get("parent", "")
    except (json.JSONDecodeError, KeyError):
        pass

    # Fetch database name from the branch
    database = ""
    if branch:
        db_result = run_command(
            [
                "databricks",
                "-p",
                profile_name,
                "api",
                "get",
                f"/api/2.0/postgres/{branch}/databases",
                "--output",
                "json",
            ],
            check=False,
        )
        if db_result.returncode == 0 and db_result.stdout:
            try:
                db_data = json.loads(db_result.stdout)
                databases = db_data.get("databases", [])
                if databases:
                    database = databases[0].get("name", "")
            except (json.JSONDecodeError, IndexError, KeyError):
                pass

    if not branch:
        print_error(
            "Could not resolve branch path from endpoint response "
            "(missing 'parent' field). Please check the endpoint configuration."
        )
        return None
    if not database:
        print_error(
            f"Could not resolve database from branch '{branch}' "
            "(the databases API returned no results). Please check the endpoint configuration."
        )
        return None

    return {"endpoint": endpoint, "host": host, "branch": branch, "database": database}


def setup_lakebase(
    profile_name: str,
    username: str,
    autoscaling_endpoint: str = None,
    create_new_lakebase_proj: str = None,
    purpose: str = "memory",
) -> dict:
    """Set up Lakebase autoscaling instance.

    Args:
        purpose: "memory" for agent memory templates, "ui" for chat UI conversation history.

    Returns:
        Dict with {"type": "autoscaling", "endpoint": str}
    """
    if purpose == "ui":
        print_step("Setting up Lakebase for chat UI conversation history...")
    else:
        print_step("Setting up Lakebase instance for agent memory...")

    # If --lakebase-create-new was provided, provision a new autoscaling project + branch
    if create_new_lakebase_proj:
        print(f"Creating new Lakebase autoscaling project: {create_new_lakebase_proj}")
        selection = create_lakebase_instance(profile_name, create_new_lakebase_proj)
        endpoint = selection["endpoint"]
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", endpoint)
        # Clear any stale provisioned instance name from a previous config
        update_env_file("LAKEBASE_INSTANCE_NAME", "")

        pg_host = selection.get("host", "")
        if pg_host:
            update_env_file("PGHOST", pg_host)
            print_success(f"PGHOST set to '{pg_host}'")

        update_env_file("PGUSER", username)
        print_success(f"PGUSER set to '{username}'")

        update_env_file("PGDATABASE", "databricks_postgres")
        print_success("PGDATABASE set to 'databricks_postgres'")

        print_success(f"Lakebase autoscaling endpoint saved to .env: {endpoint}")
        return selection

    # If --lakebase-autoscaling-endpoint was provided
    if autoscaling_endpoint:
        print(f"Using autoscaling Lakebase endpoint: {autoscaling_endpoint}")
        endpoint_info = validate_lakebase_autoscaling_endpoint(profile_name, autoscaling_endpoint)
        if not endpoint_info:
            sys.exit(1)
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", autoscaling_endpoint)
        # Clear any stale provisioned instance name from a previous config
        update_env_file("LAKEBASE_INSTANCE_NAME", "")

        pg_host = endpoint_info.get("host", "")
        if pg_host:
            update_env_file("PGHOST", pg_host)
            print_success(f"PGHOST set to '{pg_host}'")
        else:
            print_error(
                "Could not resolve PGHOST from endpoint. "
                "Local PostgreSQL connections may not work until PGHOST is set manually in .env."
            )

        update_env_file("PGUSER", username)
        print_success(f"PGUSER set to '{username}'")

        update_env_file("PGDATABASE", "databricks_postgres")
        print_success("PGDATABASE set to 'databricks_postgres'")

        print_success(
            f"Lakebase autoscaling endpoint saved to .env: {autoscaling_endpoint}"
        )
        return {
            "type": "autoscaling",
            "endpoint": autoscaling_endpoint,
            "host": pg_host,
            "branch": endpoint_info["branch"],
            "database": endpoint_info["database"],
        }

    # Interactive selection
    selection = select_lakebase_interactive(profile_name)

    endpoint = selection["endpoint"]
    endpoint_info = validate_lakebase_autoscaling_endpoint(profile_name, endpoint)
    if not endpoint_info:
        sys.exit(1)
    update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", endpoint)
    # Clear any stale provisioned instance name from a previous config
    update_env_file("LAKEBASE_INSTANCE_NAME", "")

    pg_host = endpoint_info.get("host", "")
    if pg_host:
        update_env_file("PGHOST", pg_host)
        print_success(f"PGHOST set to '{pg_host}'")
    else:
        print_error(
            "Could not resolve PGHOST from endpoint. "
            "Local PostgreSQL connections may not work until PGHOST is set manually in .env."
        )

    update_env_file("PGUSER", username)
    print_success(f"PGUSER set to '{username}'")

    update_env_file("PGDATABASE", "databricks_postgres")
    print_success("PGDATABASE set to 'databricks_postgres'")

    print_success(
        f"Lakebase autoscaling endpoint saved to .env: {endpoint}"
    )
    # Merge branch/database from endpoint validation into selection
    selection["branch"] = endpoint_info["branch"]
    selection["database"] = endpoint_info["database"]

    return selection


def _replace_lakebase_env_vars(content: str, lakebase_config: dict) -> str:
    """Remove all Lakebase env var lines and insert only the relevant ones.

    Handles both active and commented-out LAKEBASE_ env vars, plus their
    associated comment lines (e.g. "# Autoscaling Lakebase config").
    """
    lines = content.splitlines()
    result = []
    insert_idx = None
    skip_next_value = False

    for line in lines:
        if skip_next_value:
            skip_next_value = False
            if re.match(r"\s*(?:#\s*)?(?:value|value_from)\s*:", line):
                continue
            # Not a value line — fall through to normal processing

        stripped = line.strip()

        # Match lakebase section comments
        bare = stripped.lstrip("#").strip().lower()
        if bare == "autoscaling lakebase config":
            if insert_idx is None:
                insert_idx = len(result)
            continue

        # Match only the LAKEBASE_ env vars that quickstart manages
        if re.search(r"- name: LAKEBASE_(INSTANCE_NAME|AUTOSCALING_ENDPOINT|AUTOSCALING_PROJECT|AUTOSCALING_BRANCH)", stripped):
            if insert_idx is None:
                insert_idx = len(result)
            skip_next_value = True
            continue

        result.append(line)

    if insert_idx is None:
        return content

    # Detect indent from surrounding `- name:` env var lines
    indent = "          "
    for line in result:
        m = re.match(r"^(\s+)- name: ", line)
        if m:
            indent = m.group(1)
            break

    # Build replacement block with the autoscaling endpoint env var
    new_lines = [
        f"{indent}- name: LAKEBASE_AUTOSCALING_ENDPOINT",
        f'{indent}  value_from: "postgres"',
    ]

    final = result[:insert_idx] + new_lines + result[insert_idx:]
    return "\n".join(final) + "\n"


def _build_postgres_resource_lines(indent: str, lakebase_config: dict) -> list[str]:
    """Build the postgres resource YAML lines from a lakebase config dict.

    DAB requires branch and database fields (not endpoint) for postgres resources.
    """
    lines = [
        f"{indent}- name: 'postgres'",
        f"{indent}  postgres:",
    ]
    if "branch" in lakebase_config:
        lines.append(f'{indent}    branch: "{lakebase_config["branch"]}"')
    if "database" in lakebase_config:
        lines.append(f'{indent}    database: "{lakebase_config["database"]}"')
    lines.append(f"{indent}    permission: 'CAN_CONNECT_AND_CREATE'")
    return lines


def _replace_lakebase_resource(content: str, lakebase_config: dict) -> str:
    """Update the Lakebase postgres resource section in databricks.yml.

    Fills in the autoscaling postgres resource block with actual values, and
    removes any legacy provisioned database resource block (no longer supported).
    """
    LAKEBASE_COMMENTS = {
        "autoscaling postgres resource",
        "use for provisioned lakebase resource",
        # Backward compat: old comment text from pre-native-postgres templates
        "autoscaling postgres resource must be added via api after deploy",
        "see: .claude/skills/add-tools/examples/lakebase-autoscaling.md",
        "see: .claude/skills/add-tools/examples/lakebase-autoscaling.yaml",
    }

    lines = content.splitlines()
    result = []
    i = 0
    found_database = False
    found_postgres = False
    resource_indent = None

    def _detect_indent():
        nonlocal resource_indent
        if resource_indent is None:
            for prev in reversed(result):
                m = re.match(r"^(\s+)- name:", prev)
                if m:
                    resource_indent = m.group(1)
                    break

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        bare = stripped.lstrip("#").strip().lower()

        # Skip lakebase-related comment lines in the resources section
        if bare in LAKEBASE_COMMENTS or (bare == "" and stripped == "#"):
            is_lakebase_area = False
            if bare in LAKEBASE_COMMENTS:
                is_lakebase_area = True
            elif stripped == "#":
                # Check surrounding lines for lakebase context
                for offset in [-1, 1]:
                    neighbor_idx = i + offset
                    if 0 <= neighbor_idx < len(lines):
                        neighbor_bare = lines[neighbor_idx].strip().lstrip("#").strip().lower()
                        if neighbor_bare in LAKEBASE_COMMENTS or "database" in neighbor_bare or "postgres" in neighbor_bare:
                            is_lakebase_area = True
                            break

            if is_lakebase_area:
                _detect_indent()
                i += 1
                continue

        # Match the commented-out database resource lines (legacy provisioned).
        # Provisioned is no longer supported — drop the block without inserting.
        if re.match(r"\s*#\s*- name: ['\"]?database['\"]?", stripped):
            found_database = True
            _detect_indent()
            # Skip all subsequent commented lines that are part of this block
            i += 1
            while i < len(lines):
                next_stripped = lines[i].strip()
                if next_stripped.startswith("#") and (
                    "database:" in next_stripped
                    or "instance_name:" in next_stripped
                    or "database_name:" in next_stripped
                    or "permission:" in next_stripped
                ):
                    i += 1
                else:
                    break
            continue

        # Match an uncommented database resource (from a previous provisioned run).
        # Provisioned is no longer supported — drop the block without inserting.
        if re.match(r"\s*- name: ['\"]?database['\"]?", stripped):
            found_database = True
            if resource_indent is None:
                m = re.match(r"^(\s+)- name:", line)
                if m:
                    resource_indent = m.group(1)
            # Skip all subsequent lines that are part of this block
            i += 1
            while i < len(lines):
                next_stripped = lines[i].strip()
                if next_stripped and not next_stripped.startswith("-") and not next_stripped.startswith("#"):
                    i += 1
                else:
                    break
            continue

        # Match the commented-out postgres resource lines
        if re.match(r"\s*#\s*- name: ['\"]?postgres['\"]?", stripped):
            found_postgres = True
            _detect_indent()
            # Skip all subsequent commented lines that are part of this block
            i += 1
            while i < len(lines):
                next_stripped = lines[i].strip()
                if next_stripped.startswith("#") and (
                    "postgres:" in next_stripped
                    or "branch:" in next_stripped
                    or "endpoint:" in next_stripped
                    or "database:" in next_stripped
                    or "permission:" in next_stripped
                ):
                    i += 1
                else:
                    break

            # Insert the uncommented postgres resource block
            indent = resource_indent or "        "
            result.extend(_build_postgres_resource_lines(indent, lakebase_config))
            continue

        # Match an uncommented postgres resource (from a previous autoscaling run or template default)
        if re.match(r"\s*- name: ['\"]?postgres['\"]?", stripped):
            found_postgres = True
            if resource_indent is None:
                m = re.match(r"^(\s+)- name:", line)
                if m:
                    resource_indent = m.group(1)
            # Skip all subsequent lines that are part of this block
            i += 1
            while i < len(lines):
                next_stripped = lines[i].strip()
                if next_stripped and not next_stripped.startswith("-") and not next_stripped.startswith("#"):
                    i += 1
                else:
                    break

            # Insert the updated postgres resource block
            indent = resource_indent or "        "
            result.extend(_build_postgres_resource_lines(indent, lakebase_config))
            continue

        result.append(line)
        i += 1

    # If no existing postgres resource was found (e.g. after a legacy provisioned
    # database resource was removed), append the resource block after the last
    # resource entry. Only do this if we found some lakebase resource (database or
    # comments), indicating this is a lakebase-enabled template.
    if not found_postgres and found_database:
        insert_idx = _find_last_resource_insert_idx(result)
        if insert_idx is not None:
            if resource_indent is None:
                for idx in range(insert_idx - 1, -1, -1):
                    m = re.match(r"^(\s+)- name:", result[idx])
                    if m:
                        resource_indent = m.group(1)
                        break
            indent = resource_indent or "        "
            new_lines = _build_postgres_resource_lines(indent, lakebase_config)
            result = result[:insert_idx] + new_lines + result[insert_idx:]

    return "\n".join(result) + "\n"


def _find_last_resource_insert_idx(lines: list[str]) -> int | None:
    """Find the index after the last resource block entry in the lines list."""
    for idx in range(len(lines) - 1, -1, -1):
        if re.match(r"\s+- name:", lines[idx]):
            # Find the end of this resource block
            insert_idx = idx + 1
            while insert_idx < len(lines):
                next_stripped = lines[insert_idx].strip()
                if next_stripped and not next_stripped.startswith("-") and not next_stripped.startswith("#"):
                    insert_idx += 1
                else:
                    break
            return insert_idx
    return None


def update_databricks_yml_lakebase(lakebase_config: dict) -> None:
    """Update databricks.yml: keep only the relevant Lakebase env vars and resources."""
    yml_path = Path("databricks.yml")
    if not yml_path.exists():
        return

    content = yml_path.read_text()
    updated = _replace_lakebase_env_vars(content, lakebase_config)
    updated = _replace_lakebase_resource(updated, lakebase_config)
    if updated != content:
        yml_path.write_text(updated)
        print_success("Updated databricks.yml with Lakebase config")



def get_databricks_yml_experiment_id() -> str:
    """Read the experiment_id already written into databricks.yml, if any.

    Returns the experiment_id string, or "" if not set / file missing.
    Useful for re-running quickstart against a previously-configured app so we
    can skip experiment creation and reuse the existing ID.
    """
    yml_path = Path("databricks.yml")
    if not yml_path.exists():
        return ""
    _, data = _load_yml(yml_path)
    apps = data.get("resources", {}).get("apps", {})
    for app_val in apps.values():
        for resource in app_val.get("resources", []):
            if "experiment" in resource:
                exp_id = resource["experiment"].get("experiment_id", "")
                if exp_id and str(exp_id).strip():
                    return str(exp_id).strip()
    return ""


def update_databricks_yml_experiment(experiment_id: str) -> None:
    """Update databricks.yml to set the experiment ID in the app resource."""
    yml_path = Path("databricks.yml")
    if not yml_path.exists():
        return

    yaml, data = _load_yml(yml_path)
    apps = data.get("resources", {}).get("apps", {})
    for app_val in apps.values():
        for resource in app_val.get("resources", []):
            if "experiment" in resource:
                resource["experiment"]["experiment_id"] = DoubleQuotedScalarString(experiment_id)
    _save_yml(yaml, data, yml_path)
    print_success("Updated databricks.yml with experiment ID")


def _replace_mlflow_env_entries(
    existing: list[Any],
    trace_config: MlflowTraceConfig,
    *,
    value_from_key: str,
) -> list[Any]:
    names = {
        "MLFLOW_EXPERIMENT_ID",
        "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
        "MLFLOW_UC_CATALOG",
        "MLFLOW_UC_SCHEMA",
        "MLFLOW_UC_TABLE_PREFIX",
        "MLFLOW_OTEL_SPANS_TABLE",
    }
    retained = [entry for entry in existing if entry.get("name") not in names]
    retained.extend(
        [
            {
                "name": "MLFLOW_EXPERIMENT_ID",
                value_from_key: "experiment",
            },
            {
                "name": "MLFLOW_TRACING_SQL_WAREHOUSE_ID",
                value_from_key: "mlflow-tracing-warehouse",
            },
            {"name": "MLFLOW_UC_CATALOG", "value": trace_config.catalog_name},
            {"name": "MLFLOW_UC_SCHEMA", "value": trace_config.schema_name},
            {"name": "MLFLOW_UC_TABLE_PREFIX", "value": trace_config.table_prefix},
            {
                "name": "MLFLOW_OTEL_SPANS_TABLE",
                "value": trace_config.otel_spans_table_name,
            },
        ]
    )
    return retained


def update_mlflow_trace_runtime_config(trace_config: MlflowTraceConfig) -> None:
    """Persist trace config to the bundle and direct app runtime configuration."""
    bundle_path = Path("databricks.yml")
    if bundle_path.exists():
        yaml, data = _load_yml(bundle_path)
        apps = data.get("resources", {}).get("apps", {})
        for app in apps.values():
            config = app.setdefault("config", {})
            config["env"] = _replace_mlflow_env_entries(
                list(config.get("env", [])),
                trace_config,
                value_from_key="value_from",
            )
            resources = list(app.get("resources", []))
            experiment_found = False
            warehouse_found = False
            for resource in resources:
                if "experiment" in resource:
                    resource["experiment"]["experiment_id"] = (
                        DoubleQuotedScalarString(trace_config.experiment_id)
                    )
                    experiment_found = True
                if resource.get("name") == "mlflow-tracing-warehouse":
                    resource["sql_warehouse"] = {
                        "id": trace_config.warehouse_id,
                        "permission": "CAN_USE",
                    }
                    warehouse_found = True
            if not experiment_found:
                raise RuntimeError(
                    "databricks.yml app resource is missing its MLflow experiment binding"
                )
            if not warehouse_found:
                resources.append(
                    {
                        "name": "mlflow-tracing-warehouse",
                        "sql_warehouse": {
                            "id": trace_config.warehouse_id,
                            "permission": "CAN_USE",
                        },
                    }
                )
            app["resources"] = resources
        _save_yml(yaml, data, bundle_path)
        print_success("Updated databricks.yml with MLflow UC tracing config")

    app_path = Path("app.yaml")
    if app_path.exists():
        yaml, data = _load_yml(app_path)
        data["env"] = _replace_mlflow_env_entries(
            list(data.get("env", [])),
            trace_config,
            value_from_key="valueFrom",
        )
        _save_yml(yaml, data, app_path)
        print_success("Updated app.yaml with MLflow UC tracing config")


def update_databricks_yml_app_name(app_name: str, budget_policy_id: str | None = None) -> str:
    """Update the app name field in databricks.yml.

    Args:
        app_name: New app name to set (e.g. "agent-my-app")
        budget_policy_id: Optional budget policy ID to set on the app

    Returns:
        The bundle resource key (resources.apps.<key>), or "" if file not found.
    """
    yml_path = Path("databricks.yml")
    if not yml_path.exists():
        return ""

    yaml, data = _load_yml(yml_path)
    apps = data.get("resources", {}).get("apps", {})
    if not apps:
        return ""

    app_key = next(iter(apps))
    app_map = apps[app_key]
    app_map["name"] = DoubleQuotedScalarString(app_name)

    if budget_policy_id:
        if "budget_policy_id" not in app_map:
            app_map.insert(1, "budget_policy_id", DoubleQuotedScalarString(budget_policy_id))
        else:
            app_map["budget_policy_id"] = DoubleQuotedScalarString(budget_policy_id)

    _save_yml(yaml, data, yml_path)
    print_success(f"Updated databricks.yml app name to '{app_name}'")
    return app_key


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Quickstart setup for Databricks agent development",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    uv run quickstart                    # Interactive setup
    uv run quickstart --profile DEFAULT  # Use existing profile (non-interactive)
    uv run quickstart --host https://...  # Set up new profile with host
    uv run quickstart --lakebase-autoscaling-endpoint my-endpoint  # Autoscaling Lakebase
    uv run quickstart --lakebase-create-new my-new-project  # Provision a new Lakebase
    uv run quickstart --app-name my-existing-app  # Bind to existing Databricks app
    uv run quickstart --skip-lakebase    # Skip Lakebase setup
        """,
    )
    parser.add_argument(
        "--profile",
        help="Use specified Databricks profile (non-interactive)",
        metavar="NAME",
    )
    parser.add_argument(
        "--host",
        help="Databricks workspace URL (for initial setup)",
        metavar="URL",
    )
    parser.add_argument(
        "--lakebase-autoscaling-endpoint",
        help="Autoscaling Lakebase endpoint name",
        metavar="NAME",
    )
    parser.add_argument(
        "--lakebase-create-new",
        help="Create a new Lakebase autoscaling project with this name (non-interactive)",
        metavar="NAME",
    )
    parser.add_argument(
        "--skip-lakebase",
        action="store_true",
        help="Skip Lakebase setup (non-interactive / CI use)",
    )
    parser.add_argument(
        "--app-name",
        help="Existing Databricks app name to bind this bundle to",
        metavar="NAME",
    )
    parser.add_argument(
        "--mlflow-catalog",
        default=os.environ.get("MLFLOW_UC_CATALOG", "main"),
        help="Unity Catalog catalog for MLflow trace tables",
        metavar="NAME",
    )
    parser.add_argument(
        "--mlflow-schema",
        default=os.environ.get("MLFLOW_UC_SCHEMA", "agent_traces"),
        help="Unity Catalog schema for MLflow trace tables",
        metavar="NAME",
    )
    parser.add_argument(
        "--mlflow-table-prefix",
        default=os.environ.get("MLFLOW_UC_TABLE_PREFIX", "agents_on_apps"),
        help="Table prefix for MLflow Unity Catalog trace tables",
        metavar="NAME",
    )
    parser.add_argument(
        "--mlflow-warehouse-id",
        default=os.environ.get("MLFLOW_TRACING_SQL_WAREHOUSE_ID"),
        help="SQL warehouse used to provision and query MLflow UC trace tables",
        metavar="ID",
    )
    parser.add_argument(
        "--mlflow-experiment-name",
        default=os.environ.get("MLFLOW_EXPERIMENT_NAME"),
        help="Absolute MLflow experiment name (defaults to /Users/<user>/agents-on-apps)",
        metavar="PATH",
    )
    return parser


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    return _build_parser().parse_args(argv)


def main():
    args = _parse_args()

    try:
        print_header("Agent on Apps - Quickstart Setup")

        # Step 1: Check prerequisites
        prereqs = check_prerequisites()
        missing = check_missing_prerequisites(prereqs)

        if missing:
            print_step("Missing prerequisites:")
            for item in missing:
                print(f"  • {item}")
            print("\nPlease install the missing prerequisites and run this script again.")
            sys.exit(1)

        # Check Node.js version meets Vite requirements
        node_error = check_node_version()
        if node_error:
            print_error(f"Node.js version check failed:\n  {node_error}")
            sys.exit(1)

        # Step 2: Set up .env
        setup_env_file()

        # Step 3: Databricks authentication
        profile_name = setup_databricks_auth(args.profile, args.host)

        # Step 4: Existing app binding (optional) — do this early so app resources
        # (experiment, lakebase) take precedence over fresh creation.
        app_name = args.app_name
        if not app_name and sys.stdin.isatty():
            print_step("Optional: Bind to an existing Databricks app")
            print("If you created an app via the Databricks UI before cloning this template,")
            print("you can bind this bundle to it to avoid a 'app already exists' error.")
            answer = input(
                "Enter the existing app name to bind to (or press Enter to skip): "
            ).strip()
            if answer:
                app_name = answer

        bundle_key = ""
        lakebase_config = None
        existing_app = None
        if app_name:
            bundle_key = update_databricks_yml_app_name(app_name)
            workspace = get_workspace_client(profile_name)
            if not workspace:
                raise RuntimeError("Could not connect to Databricks workspace")
            existing_app = get_existing_app(workspace, app_name)

            # Fetch resources from the existing app and use them in databricks.yml
            app_resources = get_app_resources(profile_name, app_name)
            for resource in app_resources:
                if "postgres" in resource:
                    pg = resource["postgres"]
                    lakebase_config = {"type": "autoscaling"}
                    for key in ("branch", "database"):
                        if pg.get(key):
                            lakebase_config[key] = pg[key]

                    # Resolve endpoint path and host for local dev .env via API
                    if "branch" in lakebase_config:
                        branch_path = lakebase_config["branch"]
                        parts = branch_path.split("/")
                        if (
                            len(parts) >= 4
                            and parts[0] == "projects"
                            and parts[2] == "branches"
                        ):
                            endpoint_path, endpoint_host = _fetch_autoscaling_endpoint_info(
                                profile_name, parts[1], parts[3]
                            )
                            if endpoint_path:
                                lakebase_config["endpoint"] = endpoint_path
                                lakebase_config["host"] = endpoint_host
                                update_env_file(
                                    "LAKEBASE_AUTOSCALING_ENDPOINT", endpoint_path
                                )
                                print_success(
                                    f"Lakebase endpoint '{endpoint_path}' saved to .env"
                                )
                                if endpoint_host:
                                    update_env_file("PGHOST", endpoint_host)
                                    print_success(f"PGHOST set to '{endpoint_host}'")
                    update_env_file("PGDATABASE", "databricks_postgres")
                    print_success("Using postgres resource from app")

            print(f"\nTo bind this bundle to your existing app, run:")
            if bundle_key:
                print(
                    f"  databricks bundle deployment bind {bundle_key} {app_name} --auto-approve"
                )
            print(f"  databricks bundle deploy")

        # Step 5: Get username and create MLflow experiment
        print_step("Getting Databricks username...")
        username = get_databricks_username(profile_name)
        print(f"Username: {username}")

        # Set PGUSER now that we have the username (needed for app-bind and lakebase paths)
        if lakebase_config:
            update_env_file("PGUSER", username)
            print_success(f"PGUSER set to '{username}'")

        requested_trace_config = argparse.Namespace(
            experiment_name=args.mlflow_experiment_name,
            warehouse_id=args.mlflow_warehouse_id,
            catalog_name=args.mlflow_catalog,
            schema_name=args.mlflow_schema,
            table_prefix=args.mlflow_table_prefix,
        )
        trace_config = create_or_reuse_uc_trace_experiment(
            profile_name,
            username,
            requested_trace_config,
        )
        write_mlflow_trace_env_atomically(trace_config)
        print_success("Updated .env with complete MLflow UC tracing config")
        update_mlflow_trace_runtime_config(trace_config)
        experiment_name = trace_config.experiment_name
        experiment_id = trace_config.experiment_id

        if app_name and existing_app is not None:
            workspace = get_workspace_client(profile_name)
            if not workspace:
                raise RuntimeError("Could not connect to Databricks workspace")
            grant_uc_trace_access_to_app(workspace, app_name, trace_config)
            print_success(
                f"Granted app '{app_name}' explicit access to MLflow UC trace tables"
            )
        elif app_name:
            print(
                f"App '{app_name}' does not exist yet. After the first deploy, rerun "
                "quickstart with the same --app-name to apply required MLflow UC grants."
            )

        # Step 6: Lakebase setup
        # lakebase_config may already be set from app resources above
        lakebase_memory_required = bool(
            args.lakebase_autoscaling_endpoint
            or args.lakebase_create_new
            or check_lakebase_required()
        )

        if lakebase_config:
            # Already got config from app resources — skip interactive setup
            print_step("Using Lakebase config from app resources")
        elif lakebase_memory_required:
            # Check for existing config (idempotency)
            existing_lakebase = get_existing_lakebase_config()
            if existing_lakebase and not args.lakebase_autoscaling_endpoint and not args.lakebase_create_new and validate_lakebase_config(
                profile_name, existing_lakebase
            ):
                print_step("Reusing existing Lakebase config from .env")
                lakebase_config = existing_lakebase
            else:
                lakebase_config = setup_lakebase(
                    profile_name,
                    username,
                    autoscaling_endpoint=args.lakebase_autoscaling_endpoint,
                    create_new_lakebase_proj=args.lakebase_create_new,
                    purpose="memory",
                )
        elif not args.skip_lakebase:
            # Optional for non-memory templates — for UI chat history
            existing_lakebase = get_existing_lakebase_config()
            if existing_lakebase and validate_lakebase_config(profile_name, existing_lakebase):
                print_step("Reusing existing Lakebase config from .env")
                lakebase_config = existing_lakebase
            else:
                print_step("Optional: Set up Lakebase for chat UI")
                print("The built-in chat UI can save conversation history across sessions")
                print("if connected to Lakebase. This is for the UI to persist chats —")
                print("not for the agent itself.")
                answer = input("Set up Lakebase for chat history? [Y/n]: ").strip().lower()
                if answer != "n":
                    lakebase_config = setup_lakebase(
                        profile_name,
                        username,
                        purpose="ui",
                    )

        if lakebase_config:
            # Update databricks.yml with Lakebase config
            update_databricks_yml_lakebase(lakebase_config)

        # Final summary
        host = get_databricks_host(profile_name)

        print_header("Setup Complete!")
        summary = f"""
✓ Prerequisites verified (uv, Node.js, Databricks CLI)
✓ Databricks authenticated with profile: {profile_name}
✓ Configuration files created (.env)

✓ MLflow experiment set up for tracing and evaluation: {experiment_name}
✓ Experiment ID: {experiment_id}
✓ MLflow UC spans table: {trace_config.otel_spans_table_name}
✓ MLflow tracing SQL warehouse: {trace_config.warehouse_id}"""

        if host and experiment_id:
            summary += f"\n  {host}/ml/experiments/{experiment_id}"

        if lakebase_config:
            lakebase_purpose = "agent memory" if lakebase_memory_required else "chat UI conversation history"
            if "endpoint" in lakebase_config:
                summary += f"\n\n✓ Lakebase for {lakebase_purpose}: endpoint {lakebase_config['endpoint']}"
            elif "branch" in lakebase_config:
                summary += f"\n\n✓ Lakebase for {lakebase_purpose}: {lakebase_config['branch']}"
            else:
                summary += f"\n\n✓ Lakebase for {lakebase_purpose}: autoscaling"

        summary += "\nNext step: Run 'uv run start-app' to start the agent locally\n"
        print(summary)

    except KeyboardInterrupt:
        print("\n\nSetup cancelled.")
        sys.exit(1)


if __name__ == "__main__":
    main()
