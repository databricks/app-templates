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
  5. MLflow experiment — if not already set from app resources (step 4), get username,
     seed MLFLOW_EXPERIMENT_ID from databricks.yml if not in .env, then create or
     reuse an experiment. Update .env and databricks.yml.
  6. Lakebase setup — skip if already resolved from app resources (step 4).
     Otherwise: if the template requires Lakebase (has LAKEBASE_* in databricks.yml)
     or CLI flags are provided, set up via CLI args or interactive selection.
     For non-memory templates, optionally offer Lakebase for chat UI history.
     Update databricks.yml resources and env vars, and app.yaml env vars.
  7. Print summary with links to experiment and Lakebase.

Usage:
    uv run quickstart [OPTIONS]

Options:
    --profile NAME    Use specified Databricks profile (non-interactive)
    --host URL        Databricks workspace URL (for initial setup)
    --lakebase-provisioned-name NAME   Provisioned Lakebase instance name
    --lakebase-autoscaling-endpoint NAME  Autoscaling Lakebase endpoint name
    --skip-lakebase   Skip Lakebase setup (non-interactive / CI use)
    --app-name NAME   Existing Databricks app name to bind this bundle to
    -h, --help        Show this help message
"""

import argparse
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.scalarstring import DoubleQuotedScalarString


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


def create_mlflow_experiment(profile_name: str, username: str) -> tuple[str, str]:
    """Create (or reuse) an MLflow experiment and return (name, id)."""
    print_step("Setting up MLflow experiment...")

    w = get_workspace_client(profile_name)
    if not w:
        print_error("Could not connect to Databricks workspace")
        print_troubleshooting_api()
        sys.exit(1)

    # Check if we already have an experiment ID in .env (idempotency)
    existing_id = get_env_value("MLFLOW_EXPERIMENT_ID")
    if existing_id:
        try:
            exp = w.experiments.get_experiment(experiment_id=existing_id).experiment
            if exp and exp.name:
                print_success(f"Reusing existing experiment '{exp.name}' (ID: {existing_id})")
                return exp.name, existing_id
        except Exception:
            pass
        print("Existing experiment not found or invalid, creating a new one...")

    experiment_name = f"/Users/{username}/agents-on-apps"

    try:
        # Try to create with default name
        try:
            experiment_id = w.experiments.create_experiment(name=experiment_name).experiment_id or ""
            print_success(f"Created experiment '{experiment_name}' with ID: {experiment_id}")
            return experiment_name, experiment_id
        except Exception:
            pass

        # Name already exists, try with random suffix
        print("Experiment name already exists, creating with random suffix...")
        random_suffix = secrets.token_hex(4)
        experiment_name = f"/Users/{username}/agents-on-apps-{random_suffix}"
        experiment_id = w.experiments.create_experiment(name=experiment_name).experiment_id or ""
        print_success(f"Created experiment '{experiment_name}' with ID: {experiment_id}")
        return experiment_name, experiment_id

    except Exception as e:
        print_error(f"Failed to create MLflow experiment: {e}")
        print_troubleshooting_api()
        sys.exit(1)


def check_lakebase_required() -> bool:
    """Check if databricks.yml has Lakebase configuration (provisioned or autoscaling)."""
    databricks_yml = Path("databricks.yml")
    if not databricks_yml.exists():
        return False

    content = databricks_yml.read_text()
    return (
        "LAKEBASE_INSTANCE_NAME" in content
        or "LAKEBASE_AUTOSCALING_ENDPOINT" in content
    )


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
        - {"type": "provisioned", "instance_name": str}
        - None if no Lakebase config found
    """
    endpoint = get_env_value("LAKEBASE_AUTOSCALING_ENDPOINT")
    if endpoint:
        return {"type": "autoscaling", "endpoint": endpoint}

    instance_name = get_env_value("LAKEBASE_INSTANCE_NAME")
    if instance_name:
        return {"type": "provisioned", "instance_name": instance_name}

    return None


def validate_lakebase_config(profile_name: str, config: dict) -> bool:
    """Validate that an existing Lakebase config from .env is accessible in the current workspace."""
    if config["type"] == "provisioned":
        return validate_lakebase_instance(profile_name, config["instance_name"]) is not None
    elif config["type"] == "autoscaling":
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


def create_lakebase_instance(profile_name: str) -> dict:
    """Create a new Lakebase autoscaling instance (project + branch).

    Returns:
        Dict with {"type": "autoscaling", "endpoint": str}
    """
    w = get_workspace_client(profile_name)
    if not w:
        print_error("Could not connect to Databricks. Check your CLI profile.")
        sys.exit(1)

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

        # Fetch the endpoint name for the created branch
        endpoint_name = _fetch_autoscaling_endpoint_name(profile_name, project_short, branch_name)
        if not endpoint_name:
            print_error(
                "Could not determine endpoint name for the created Lakebase instance.\n"
                "  Please find the endpoint name in the Databricks UI and use:\n"
                f"  uv run quickstart --lakebase-autoscaling-endpoint <endpoint-name>"
            )
            sys.exit(1)

        return {"type": "autoscaling", "endpoint": endpoint_name}
    except Exception as e:
        print_error(f"Failed to create Lakebase instance: {e}")
        sys.exit(1)


def _fetch_autoscaling_endpoint_name(profile_name: str, project: str, branch: str) -> str:
    """Fetch the endpoint name for an autoscaling Lakebase branch.

    Returns the endpoint name string, or empty string if not found.
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
                # Use the uid field (e.g. "ep-steep-lab-d185d9o5") which is
                # the value the SDK needs to resolve the endpoint host.
                uid = endpoints[0].get("uid", "")
                if uid:
                    return uid
        except (json.JSONDecodeError, IndexError, KeyError):
            pass
    return ""


def select_lakebase_interactive(profile_name: str) -> dict:
    """Interactive Lakebase setup.

    Flow:
    1. New or existing?
    2. New -> Create autoscaling project + branch, return endpoint
    3. Existing -> Autoscaling endpoint or provisioned?

    Returns:
        Dict with either:
        - {"type": "provisioned", "instance_name": str}
        - {"type": "autoscaling", "endpoint": str}
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

    # Existing instance
    print("\nWhat type of Lakebase instance?")
    print("  See https://docs.databricks.com/aws/en/oltp/#feature-comparison for details.")
    print("  1) Autoscaling (recommended)")
    print("  2) Provisioned")
    print()

    while True:
        type_choice = input("Enter your choice (1 or 2): ").strip()
        if type_choice in ("1", "2"):
            break
        print_error("Please enter 1 or 2")

    if type_choice == "2":
        name = input("\nEnter the provisioned Lakebase instance name: ").strip()
        if not name:
            print_error("Instance name is required")
            sys.exit(1)
        return {"type": "provisioned", "instance_name": name}

    # Autoscaling - ask for endpoint name
    endpoint = input("\nEnter the autoscaling Lakebase endpoint name: ").strip()
    if not endpoint:
        print_error("Endpoint name is required")
        sys.exit(1)

    return {"type": "autoscaling", "endpoint": endpoint}


def validate_lakebase_instance(profile_name: str, lakebase_name: str) -> dict | None:
    """Validate that the Lakebase instance exists and user has access.

    Returns the instance info dict on success, None on failure.
    """
    print(f"Validating Lakebase instance '{lakebase_name}'...")

    result = run_command(
        [
            "databricks",
            "-p",
            profile_name,
            "database",
            "get-database-instance",
            lakebase_name,
            "--output",
            "json",
        ],
        check=False,
    )

    if result.returncode == 0:
        print_success(f"Lakebase instance '{lakebase_name}' validated")
        return json.loads(result.stdout)

    # Check if database command is not recognized (old CLI version)
    if 'unknown command "database" for "databricks"' in (result.stderr or ""):
        print_error(
            "The 'databricks database' command requires a newer version of the Databricks CLI."
        )
        print("  Please upgrade: https://docs.databricks.com/dev-tools/cli/install.html")
        return None

    error_msg = result.stderr.lower() if result.stderr else ""
    if "not found" in error_msg:
        print_error(
            f"Lakebase instance '{lakebase_name}' not found. Please check the instance name."
        )
    elif "permission" in error_msg or "forbidden" in error_msg or "unauthorized" in error_msg:
        print_error(f"No permission to access Lakebase instance '{lakebase_name}'")
    else:
        print_error(
            f"Failed to validate Lakebase instance: {result.stderr.strip() if result.stderr else 'Unknown error'}"
        )
    return None


def validate_lakebase_autoscaling_endpoint(profile_name: str, endpoint: str) -> dict | None:
    """Validate that the Lakebase autoscaling endpoint exists.

    Uses the postgres API to verify the endpoint.

    Returns a dict with {"endpoint": str} on success, or None on failure.
    """
    print(f"Validating Lakebase autoscaling endpoint '{endpoint}'...")

    result = run_command(
        [
            "databricks",
            "-p",
            profile_name,
            "api",
            "get",
            f"/api/2.0/postgres/endpoints/{endpoint}",
            "--output",
            "json",
        ],
        check=False,
    )

    if result.returncode == 0:
        print_success(f"Lakebase autoscaling endpoint '{endpoint}' validated")
        return {"endpoint": endpoint}

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


def setup_lakebase(
    profile_name: str,
    username: str,
    provisioned_name: str = None,
    autoscaling_endpoint: str = None,
    purpose: str = "memory",
) -> dict:
    """Set up Lakebase instance.

    Args:
        purpose: "memory" for agent memory templates, "ui" for chat UI conversation history.

    Returns:
        Dict with either:
        - {"type": "provisioned", "instance_name": str}
        - {"type": "autoscaling", "endpoint": str}
    """
    if purpose == "ui":
        print_step("Setting up Lakebase for chat UI conversation history...")
    else:
        print_step("Setting up Lakebase instance for agent memory...")

    # If --lakebase-provisioned-name was provided, use it directly
    if provisioned_name:
        print(f"Using provided provisioned Lakebase instance: {provisioned_name}")
        instance_info = validate_lakebase_instance(profile_name, provisioned_name)
        if not instance_info:
            sys.exit(1)
        update_env_file("LAKEBASE_INSTANCE_NAME", provisioned_name)
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "")
        print_success(f"Lakebase instance name '{provisioned_name}' saved to .env")

        # Set up PostgreSQL connection environment variables
        pg_host = instance_info.get("read_write_dns", "")
        if pg_host:
            update_env_file("PGHOST", pg_host)
            print_success(f"PGHOST set to '{pg_host}'")
        else:
            print_error("Could not get read_write_dns from Lakebase instance")

        update_env_file("PGUSER", username)
        print_success(f"PGUSER set to '{username}'")

        update_env_file("PGDATABASE", "databricks_postgres")
        print_success("PGDATABASE set to 'databricks_postgres'")

        return {"type": "provisioned", "instance_name": provisioned_name}

    # If --lakebase-autoscaling-endpoint was provided
    if autoscaling_endpoint:
        print(f"Using autoscaling Lakebase endpoint: {autoscaling_endpoint}")
        endpoint_info = validate_lakebase_autoscaling_endpoint(profile_name, autoscaling_endpoint)
        if not endpoint_info:
            sys.exit(1)
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", autoscaling_endpoint)
        update_env_file("LAKEBASE_INSTANCE_NAME", "")

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
        }

    # Interactive selection
    selection = select_lakebase_interactive(profile_name)

    if selection["type"] == "provisioned":
        instance_name = selection["instance_name"]
        instance_info = validate_lakebase_instance(profile_name, instance_name)
        if not instance_info:
            sys.exit(1)
        update_env_file("LAKEBASE_INSTANCE_NAME", instance_name)
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "")
        print_success(f"Lakebase provisioned instance '{instance_name}' saved to .env")

        # Set up PostgreSQL connection environment variables
        pg_host = instance_info.get("read_write_dns", "")
        if pg_host:
            update_env_file("PGHOST", pg_host)
            print_success(f"PGHOST set to '{pg_host}'")
        else:
            print_error("Could not get read_write_dns from Lakebase instance")

        update_env_file("PGUSER", username)
        print_success(f"PGUSER set to '{username}'")

        update_env_file("PGDATABASE", "databricks_postgres")
        print_success("PGDATABASE set to 'databricks_postgres'")
    else:
        endpoint = selection["endpoint"]
        endpoint_info = validate_lakebase_autoscaling_endpoint(profile_name, endpoint)
        if not endpoint_info:
            sys.exit(1)
        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", endpoint)
        update_env_file("LAKEBASE_INSTANCE_NAME", "")

        update_env_file("PGUSER", username)
        print_success(f"PGUSER set to '{username}'")

        update_env_file("PGDATABASE", "databricks_postgres")
        print_success("PGDATABASE set to 'databricks_postgres'")

        print_success(
            f"Lakebase autoscaling endpoint saved to .env: {endpoint}"
        )

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
        if bare in (
            "autoscaling lakebase config",
            "use for provisioned lakebase resource",
            "provisioned lakebase config",
        ):
            if insert_idx is None:
                insert_idx = len(result)
            continue

        # Match LAKEBASE_ env var lines (active or commented)
        if re.search(r"- name: LAKEBASE_", stripped):
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

    # Build replacement block with only the relevant env vars
    if lakebase_config["type"] == "provisioned":
        new_lines = [
            f"{indent}- name: LAKEBASE_INSTANCE_NAME",
            f'{indent}  value: "{lakebase_config["instance_name"]}"',
        ]
    else:
        new_lines = [
            f"{indent}- name: LAKEBASE_AUTOSCALING_ENDPOINT",
            f'{indent}  value_from: "postgres"',
        ]

    final = result[:insert_idx] + new_lines + result[insert_idx:]
    return "\n".join(final) + "\n"


def _build_postgres_resource_lines(indent: str, lakebase_config: dict) -> list[str]:
    """Build the postgres resource YAML lines from a lakebase config dict.

    Supports both endpoint-based and branch+database-based configs.
    """
    lines = [
        f"{indent}- name: 'postgres'",
        f"{indent}  postgres:",
    ]
    if "endpoint" in lakebase_config:
        lines.append(f'{indent}    endpoint: "{lakebase_config["endpoint"]}"')
    if "branch" in lakebase_config:
        lines.append(f'{indent}    branch: "{lakebase_config["branch"]}"')
    if "database" in lakebase_config:
        lines.append(f'{indent}    database: "{lakebase_config["database"]}"')
    lines.append(f"{indent}    permission: 'CAN_CONNECT_AND_CREATE'")
    return lines


def _replace_lakebase_resource(content: str, lakebase_config: dict) -> str:
    """Update the Lakebase database/postgres resource section in databricks.yml.

    For provisioned: uncomments and fills in the database resource block,
    removes any postgres resource block.
    For autoscaling: fills in the postgres resource block with actual values,
    removes any database resource block.
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

        # Match the commented-out database resource lines
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

            # For provisioned, insert the uncommented resource block
            if lakebase_config["type"] == "provisioned":
                indent = resource_indent or "        "
                instance_name = lakebase_config["instance_name"]
                result.append(f"{indent}- name: 'database'")
                result.append(f"{indent}  database:")
                result.append(f"{indent}    instance_name: '{instance_name}'")
                result.append(f"{indent}    database_name: 'databricks_postgres'")
                result.append(f"{indent}    permission: 'CAN_CONNECT_AND_CREATE'")
            continue

        # Match an uncommented database resource (from a previous provisioned run)
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

            # For provisioned, insert the updated resource block
            if lakebase_config["type"] == "provisioned":
                indent = resource_indent or "        "
                instance_name = lakebase_config["instance_name"]
                result.append(f"{indent}- name: 'database'")
                result.append(f"{indent}  database:")
                result.append(f"{indent}    instance_name: '{instance_name}'")
                result.append(f"{indent}    database_name: 'databricks_postgres'")
                result.append(f"{indent}    permission: 'CAN_CONNECT_AND_CREATE'")
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

            # For autoscaling, insert the uncommented postgres resource block
            if lakebase_config["type"] == "autoscaling":
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

            # For autoscaling, insert the updated postgres resource block
            if lakebase_config["type"] == "autoscaling":
                indent = resource_indent or "        "
                result.extend(_build_postgres_resource_lines(indent, lakebase_config))
            continue

        result.append(line)
        i += 1

    # If provisioned but no existing database resource was found (e.g. after autoscaling
    # removed it), append the resource block after the last resource entry.
    if lakebase_config["type"] == "provisioned" and not found_database:
        insert_idx = _find_last_resource_insert_idx(result)
        if insert_idx is not None:
            if resource_indent is None:
                for idx in range(insert_idx - 1, -1, -1):
                    m = re.match(r"^(\s+)- name:", result[idx])
                    if m:
                        resource_indent = m.group(1)
                        break
            indent = resource_indent or "        "
            instance_name = lakebase_config["instance_name"]
            new_lines = [
                f"{indent}- name: 'database'",
                f"{indent}  database:",
                f"{indent}    instance_name: '{instance_name}'",
                f"{indent}    database_name: 'databricks_postgres'",
                f"{indent}    permission: 'CAN_CONNECT_AND_CREATE'",
            ]
            result = result[:insert_idx] + new_lines + result[insert_idx:]

    # If autoscaling but no existing postgres resource was found (e.g. after provisioned
    # removed it), append the resource block after the last resource entry.
    # Only do this if we found some lakebase resource (database or comments), indicating
    # this is a lakebase-enabled template.
    if lakebase_config["type"] == "autoscaling" and not found_postgres and found_database:
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


def update_app_yaml_lakebase(lakebase_config: dict) -> None:
    """Update app.yaml: keep only the relevant Lakebase env vars, remove the others."""
    app_yaml_path = Path("app.yaml")
    if not app_yaml_path.exists():
        return

    content = app_yaml_path.read_text()
    updated = _replace_lakebase_env_vars(content, lakebase_config)
    if updated != content:
        app_yaml_path.write_text(updated)
        print_success("Updated app.yaml with Lakebase config")


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


def main():
    parser = argparse.ArgumentParser(
        description="Quickstart setup for Databricks agent development",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    uv run quickstart                    # Interactive setup
    uv run quickstart --profile DEFAULT  # Use existing profile (non-interactive)
    uv run quickstart --host https://...  # Set up new profile with host
    uv run quickstart --lakebase-provisioned-name my-db   # Provisioned Lakebase
    uv run quickstart --lakebase-autoscaling-endpoint my-endpoint  # Autoscaling
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
        "--lakebase-provisioned-name",
        help="Provisioned Lakebase instance name (non-interactive)",
        metavar="NAME",
    )
    parser.add_argument(
        "--lakebase-autoscaling-endpoint",
        help="Autoscaling Lakebase endpoint name",
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

    args = parser.parse_args()

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
        app_experiment_id = None
        if app_name:
            bundle_key = update_databricks_yml_app_name(app_name)

            # Fetch resources from the existing app and use them in databricks.yml
            app_resources = get_app_resources(profile_name, app_name)
            for resource in app_resources:
                if "experiment" in resource:
                    app_exp_id = resource["experiment"].get("experiment_id", "")
                    if app_exp_id:
                        app_experiment_id = app_exp_id
                        print_success(f"Found experiment ID from app: {app_exp_id}")

                if "postgres" in resource:
                    pg = resource["postgres"]
                    lakebase_config = {"type": "autoscaling"}
                    for key in ("branch", "database"):
                        if pg.get(key):
                            lakebase_config[key] = pg[key]

                    # Resolve endpoint name for local dev .env via API
                    if "branch" in lakebase_config:
                        branch_path = lakebase_config["branch"]
                        parts = branch_path.split("/")
                        if (
                            len(parts) >= 4
                            and parts[0] == "projects"
                            and parts[2] == "branches"
                        ):
                            endpoint_name = _fetch_autoscaling_endpoint_name(
                                profile_name, parts[1], parts[3]
                            )
                            if endpoint_name:
                                lakebase_config["endpoint"] = endpoint_name
                                update_env_file(
                                    "LAKEBASE_AUTOSCALING_ENDPOINT", endpoint_name
                                )
                                print_success(
                                    f"Lakebase endpoint '{endpoint_name}' saved to .env"
                                )
                    update_env_file("LAKEBASE_INSTANCE_NAME", "")
                    print_success("Using postgres resource from app")

                if "database" in resource:
                    db = resource["database"]
                    instance_name = db.get("instance_name", "")
                    if instance_name:
                        lakebase_config = {
                            "type": "provisioned",
                            "instance_name": instance_name,
                        }
                        update_env_file("LAKEBASE_INSTANCE_NAME", instance_name)
                        update_env_file("LAKEBASE_AUTOSCALING_ENDPOINT", "")
                        print_success(
                            f"Using database resource from app: {instance_name}"
                        )

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

        # Use experiment ID from app if available, otherwise create/reuse one
        if app_experiment_id:
            experiment_id = app_experiment_id
            experiment_name = experiment_id
            # Try to resolve experiment name for display
            w = get_workspace_client(profile_name)
            if w:
                try:
                    exp = w.experiments.get_experiment(experiment_id=experiment_id).experiment
                    if exp and exp.name:
                        experiment_name = exp.name
                except Exception:
                    pass
            update_env_file("MLFLOW_EXPERIMENT_ID", experiment_id)
            update_databricks_yml_experiment(experiment_id)
            print_success(f"Using experiment ID from app: {experiment_id}")
        else:
            # Seed MLFLOW_EXPERIMENT_ID from databricks.yml if not already in .env.
            # This handles the case where the user created the app via the Databricks UI,
            # downloaded the template (which has the experiment_id in databricks.yml already),
            # and is now running quickstart for the first time locally.
            if not get_env_value("MLFLOW_EXPERIMENT_ID"):
                yml_experiment_id = get_databricks_yml_experiment_id()
                if yml_experiment_id:
                    update_env_file("MLFLOW_EXPERIMENT_ID", yml_experiment_id)

            experiment_name, experiment_id = create_mlflow_experiment(profile_name, username)
            update_env_file("MLFLOW_EXPERIMENT_ID", experiment_id)
            print_success("Updated .env with experiment ID")
            update_databricks_yml_experiment(experiment_id)

        # Step 6: Lakebase setup
        # lakebase_config may already be set from app resources above
        lakebase_memory_required = bool(
            args.lakebase_provisioned_name
            or args.lakebase_autoscaling_endpoint
            or check_lakebase_required()
        )

        if lakebase_config:
            # Already got config from app resources — skip interactive setup
            print_step("Using Lakebase config from app resources")
        elif lakebase_memory_required:
            # Check for existing config (idempotency)
            existing_lakebase = get_existing_lakebase_config()
            if existing_lakebase and not args.lakebase_provisioned_name and not (
                args.lakebase_autoscaling_endpoint
            ) and validate_lakebase_config(profile_name, existing_lakebase):
                print_step("Reusing existing Lakebase config from .env")
                lakebase_config = existing_lakebase
            else:
                lakebase_config = setup_lakebase(
                    profile_name,
                    username,
                    provisioned_name=args.lakebase_provisioned_name,
                    autoscaling_endpoint=args.lakebase_autoscaling_endpoint,
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
            # Update databricks.yml and app.yaml with Lakebase config
            update_databricks_yml_lakebase(lakebase_config)
            update_app_yaml_lakebase(lakebase_config)

        # Final summary
        host = get_databricks_host(profile_name)

        print_header("Setup Complete!")
        summary = f"""
✓ Prerequisites verified (uv, Node.js, Databricks CLI)
✓ Databricks authenticated with profile: {profile_name}
✓ Configuration files created (.env)

✓ MLflow experiment set up for tracing and evaluation: {experiment_name}
✓ Experiment ID: {experiment_id}"""

        if host and experiment_id:
            summary += f"\n  {host}/ml/experiments/{experiment_id}"

        if lakebase_config:
            lakebase_purpose = "agent memory" if lakebase_memory_required else "chat UI conversation history"
            if lakebase_config["type"] == "provisioned":
                lakebase_name = lakebase_config["instance_name"]
                summary += f"\n\n✓ Lakebase for {lakebase_purpose}: {lakebase_name}"
                if host:
                    summary += f"\n  {host}/lakebase/provisioned/{lakebase_name}"
            else:
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
