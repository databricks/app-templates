#!/usr/bin/env python3
"""
Quickstart setup script for Databricks agent development.

This script handles:
- Checking prerequisites (uv, nvm, Node 20, Databricks CLI)
- Databricks authentication (OAuth)
- MLflow experiment creation
- Environment variable configuration (.env)
- Lakebase instance setup (for memory-enabled templates)

Usage:
    uv run quickstart [OPTIONS]

Options:
    --profile NAME    Use specified Databricks profile (non-interactive)
    --host URL        Databricks workspace URL (for initial setup)
    --lakebase-provisioned-name NAME   Provisioned Lakebase instance name
    --lakebase-autoscaling-project NAME  Autoscaling Lakebase project name
    --lakebase-autoscaling-branch NAME   Autoscaling Lakebase branch name
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
    """Update or add a key-value pair in .env."""
    env_file = Path(".env")

    if not env_file.exists():
        env_file.write_text(f"{key}={value}\n")
        return

    content = env_file.read_text()

    # Check if key exists (with or without quotes, with any value)
    pattern = rf"^{re.escape(key)}=.*$"
    if re.search(pattern, content, re.MULTILINE):
        # Replace existing key
        content = re.sub(pattern, f"{key}={value}", content, flags=re.MULTILINE)
    else:
        # Add new key
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
        result = run_command(
            ["databricks", "-p", profile_name, "current-user", "me", "--output", "json"]
        )
        user_data = json.loads(result.stdout)
        return user_data.get("userName", "")
    except Exception as e:
        print_error(f"Failed to get Databricks username: {e}")
        print_troubleshooting_api()
        sys.exit(1)


def create_mlflow_experiment(profile_name: str, username: str) -> tuple[str, str]:
    """Create an MLflow experiment and return (name, id)."""
    print_step("Creating MLflow experiment...")

    experiment_name = f"/Users/{username}/agents-on-apps"

    try:
        # Try to create with default name
        result = run_command(
            [
                "databricks",
                "-p",
                profile_name,
                "experiments",
                "create-experiment",
                experiment_name,
                "--output",
                "json",
            ],
            check=False,
        )

        if result.returncode == 0:
            experiment_id = json.loads(result.stdout).get("experiment_id", "")
            print_success(f"Created experiment '{experiment_name}' with ID: {experiment_id}")
            return experiment_name, experiment_id

        # Name already exists, try with random suffix
        print("Experiment name already exists, creating with random suffix...")
        random_suffix = secrets.token_hex(4)
        experiment_name = f"/Users/{username}/agents-on-apps-{random_suffix}"

        result = run_command(
            [
                "databricks",
                "-p",
                profile_name,
                "experiments",
                "create-experiment",
                experiment_name,
                "--output",
                "json",
            ]
        )
        experiment_id = json.loads(result.stdout).get("experiment_id", "")
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
        or "LAKEBASE_AUTOSCALING_PROJECT" in content
        or "LAKEBASE_AUTOSCALING_BRANCH" in content
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


def get_workspace_client(profile_name: str):
    """Create a WorkspaceClient with the given profile."""
    try:
        from databricks.sdk import WorkspaceClient

        return WorkspaceClient(profile=profile_name)
    except Exception:
        return None


def create_lakebase_instance(profile_name: str) -> dict:
    """Create a new Lakebase autoscaling instance (project + branch).

    Returns:
        Dict with {"type": "autoscaling", "project": str, "branch": str}
    """
    w = get_workspace_client(profile_name)
    if not w:
        print_error("Could not connect to Databricks. Check your CLI profile.")
        sys.exit(1)

    name = input("Enter a name for the new Lakebase instance: ").strip()
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
        print_success(f"Created branch: {branch_name} (id: {branch.uid})")

        return {"type": "autoscaling", "project": project_short, "branch": branch_name}
    except Exception as e:
        print_error(f"Failed to create Lakebase instance: {e}")
        sys.exit(1)


def select_lakebase_interactive(profile_name: str) -> dict:
    """Interactive Lakebase setup.

    Flow:
    1. New or existing?
    2. New -> Create autoscaling project + branch
    3. Existing -> Provisioned or autoscaling?
       - Provisioned -> Enter instance name
       - Autoscaling -> Enter project + branch names

    Returns:
        Dict with either:
        - {"type": "provisioned", "instance_name": str}
        - {"type": "autoscaling", "project": str, "branch": str}
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

    # Autoscaling - ask for project and branch
    project = input("\nEnter the autoscaling project name: ").strip()
    if not project:
        print_error("Project name is required")
        sys.exit(1)

    branch = input("Enter the branch name: ").strip()
    if not branch:
        print_error("Branch name is required")
        sys.exit(1)

    return {"type": "autoscaling", "project": project, "branch": branch}


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


def setup_lakebase(
    profile_name: str,
    username: str,
    provisioned_name: str = None,
    autoscaling_project: str = None,
    autoscaling_branch: str = None,
) -> dict:
    """Set up Lakebase instance for memory features.

    Returns:
        Dict with either:
        - {"type": "provisioned", "instance_name": str}
        - {"type": "autoscaling", "project": str, "branch": str}
    """
    print_step("Setting up Lakebase instance for memory...")

    # If --lakebase-provisioned-name was provided, use it directly
    if provisioned_name:
        print(f"Using provided provisioned Lakebase instance: {provisioned_name}")
        instance_info = validate_lakebase_instance(profile_name, provisioned_name)
        if not instance_info:
            sys.exit(1)
        update_env_file("LAKEBASE_INSTANCE_NAME", provisioned_name)
        update_env_file("LAKEBASE_AUTOSCALING_PROJECT", "")
        update_env_file("LAKEBASE_AUTOSCALING_BRANCH", "")
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

    # If --lakebase-autoscaling-project and --lakebase-autoscaling-branch were provided
    if autoscaling_project and autoscaling_branch:
        print(f"Using autoscaling Lakebase: project={autoscaling_project}, branch={autoscaling_branch}")
        update_env_file("LAKEBASE_AUTOSCALING_PROJECT", autoscaling_project)
        update_env_file("LAKEBASE_AUTOSCALING_BRANCH", autoscaling_branch)
        update_env_file("LAKEBASE_INSTANCE_NAME", "")

        update_env_file("PGUSER", username)
        print_success(f"PGUSER set to '{username}'")

        update_env_file("PGDATABASE", "databricks_postgres")
        print_success("PGDATABASE set to 'databricks_postgres'")

        print_success(
            f"Lakebase autoscaling config saved to .env (project: {autoscaling_project}, branch: {autoscaling_branch})"
        )
        return {"type": "autoscaling", "project": autoscaling_project, "branch": autoscaling_branch}

    # Interactive selection
    selection = select_lakebase_interactive(profile_name)

    if selection["type"] == "provisioned":
        instance_name = selection["instance_name"]
        instance_info = validate_lakebase_instance(profile_name, instance_name)
        if not instance_info:
            sys.exit(1)
        update_env_file("LAKEBASE_INSTANCE_NAME", instance_name)
        update_env_file("LAKEBASE_AUTOSCALING_PROJECT", "")
        update_env_file("LAKEBASE_AUTOSCALING_BRANCH", "")
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
        project = selection["project"]
        branch = selection["branch"]
        update_env_file("LAKEBASE_AUTOSCALING_PROJECT", project)
        update_env_file("LAKEBASE_AUTOSCALING_BRANCH", branch)
        update_env_file("LAKEBASE_INSTANCE_NAME", "")

        update_env_file("PGUSER", username)
        print_success(f"PGUSER set to '{username}'")

        update_env_file("PGDATABASE", "databricks_postgres")
        print_success("PGDATABASE set to 'databricks_postgres'")

        print_success(
            f"Lakebase autoscaling config saved to .env (project: {project}, branch: {branch})"
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
            f"{indent}- name: LAKEBASE_AUTOSCALING_PROJECT",
            f'{indent}  value: "{lakebase_config["project"]}"',
            f"{indent}- name: LAKEBASE_AUTOSCALING_BRANCH",
            f'{indent}  value: "{lakebase_config["branch"]}"',
        ]

    final = result[:insert_idx] + new_lines + result[insert_idx:]
    return "\n".join(final) + "\n"


def _replace_lakebase_resource(content: str, lakebase_config: dict) -> str:
    """Update the Lakebase database resource section in databricks.yml.

    For provisioned: uncomments and fills in the database resource block.
    For autoscaling: removes the commented-out provisioned resource block
    (autoscaling postgres resource is added via API after deploy).
    """
    LAKEBASE_COMMENTS = {
        "autoscaling postgres resource must be added via api after deploy",
        "see: .claude/skills/add-tools/examples/lakebase-autoscaling.md",
        "use for provisioned lakebase resource",
    }

    lines = content.splitlines()
    result = []
    i = 0
    found_database = False
    resource_indent = None

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        bare = stripped.lstrip("#").strip().lower()

        # Skip lakebase-related comment lines in the resources section
        if bare in LAKEBASE_COMMENTS or (bare == "" and stripped == "#"):
            # Bare "#" line between lakebase resource comments — skip it
            # But only if we're inside the lakebase resource area (near other lakebase comments)
            # Check if next or previous lines are lakebase-related
            is_lakebase_area = False
            if bare in LAKEBASE_COMMENTS:
                is_lakebase_area = True
            elif stripped == "#":
                # Check surrounding lines for lakebase context
                for offset in [-1, 1]:
                    neighbor_idx = i + offset
                    if 0 <= neighbor_idx < len(lines):
                        neighbor_bare = lines[neighbor_idx].strip().lstrip("#").strip().lower()
                        if neighbor_bare in LAKEBASE_COMMENTS or "database" in neighbor_bare:
                            is_lakebase_area = True
                            break

            if is_lakebase_area:
                if resource_indent is None:
                    for prev in reversed(result):
                        m = re.match(r"^(\s+)- name:", prev)
                        if m:
                            resource_indent = m.group(1)
                            break
                i += 1
                continue

        # Match the commented-out database resource lines
        if re.match(r"\s*#\s*- name: ['\"]?database['\"]?", stripped):
            found_database = True
            if resource_indent is None:
                for prev in reversed(result):
                    m = re.match(r"^(\s+)- name:", prev)
                    if m:
                        resource_indent = m.group(1)
                        break
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

        result.append(line)
        i += 1

    # If provisioned but no existing database resource was found (e.g. after autoscaling
    # removed it), append the resource block after the last resource entry
    if lakebase_config["type"] == "provisioned" and not found_database:
        # Find the last "- name:" line in the resources section to insert after
        insert_idx = None
        for idx in range(len(result) - 1, -1, -1):
            if re.match(r"\s+- name:", result[idx]):
                # Find the end of this resource block
                insert_idx = idx + 1
                while insert_idx < len(result):
                    next_stripped = result[insert_idx].strip()
                    if next_stripped and not next_stripped.startswith("-") and not next_stripped.startswith("#"):
                        insert_idx += 1
                    else:
                        break
                if resource_indent is None:
                    m = re.match(r"^(\s+)- name:", result[idx])
                    if m:
                        resource_indent = m.group(1)
                break

        if insert_idx is not None:
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

    return "\n".join(result) + "\n"


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


def update_databricks_yml_experiment(experiment_id: str) -> None:
    """Update databricks.yml to set the experiment ID in the app resource."""
    yml_path = Path("databricks.yml")
    if not yml_path.exists():
        return

    content = yml_path.read_text()

    # Set the experiment_id in the app's experiment resource
    content = re.sub(
        r'(experiment_id: )"[^"]*"',
        f'\\1"{experiment_id}"',
        content,
    )

    yml_path.write_text(content)
    print_success("Updated databricks.yml with experiment ID")


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
    uv run quickstart --lakebase-autoscaling-project proj --lakebase-autoscaling-branch br  # Autoscaling
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
        "--lakebase-autoscaling-project",
        help="Autoscaling Lakebase project name (use with --lakebase-autoscaling-branch)",
        metavar="NAME",
    )
    parser.add_argument(
        "--lakebase-autoscaling-branch",
        help="Autoscaling Lakebase branch name (use with --lakebase-autoscaling-project)",
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

        # Step 4: Get username and create MLflow experiment
        print_step("Getting Databricks username...")
        username = get_databricks_username(profile_name)
        print(f"Username: {username}")

        experiment_name, experiment_id = create_mlflow_experiment(profile_name, username)

        # Step 5: Update .env with experiment ID
        update_env_file("MLFLOW_EXPERIMENT_ID", experiment_id)
        print_success("Updated .env with experiment ID")

        # Step 5b: Update databricks.yml to use literal experiment ID
        update_databricks_yml_experiment(experiment_id)

        # Step 6: Lakebase setup (if needed for memory features)
        lakebase_config = None
        lakebase_required = (
            args.lakebase_provisioned_name
            or (args.lakebase_autoscaling_project and args.lakebase_autoscaling_branch)
            or check_lakebase_required()
        )
        if lakebase_required:
            lakebase_config = setup_lakebase(
                profile_name,
                username,
                provisioned_name=args.lakebase_provisioned_name,
                autoscaling_project=args.lakebase_autoscaling_project,
                autoscaling_branch=args.lakebase_autoscaling_branch,
            )
            # Step 6b: Update databricks.yml and app.yaml with Lakebase config
            update_databricks_yml_lakebase(lakebase_config)
            update_app_yaml_lakebase(lakebase_config)

        # Final summary
        host = get_databricks_host(profile_name)

        print_header("Setup Complete!")
        summary = f"""
✓ Prerequisites verified (uv, Node.js, Databricks CLI)
✓ Databricks authenticated with profile: {profile_name}
✓ Configuration files created (.env)

✓ MLflow experiment created for tracing and evaluation: {experiment_name}
✓ Experiment ID: {experiment_id}"""

        if host and experiment_id:
            summary += f"\n  {host}/ml/experiments/{experiment_id}"

        if lakebase_config:
            if lakebase_config["type"] == "provisioned":
                lakebase_name = lakebase_config["instance_name"]
                summary += f"\n\n✓ Lakebase provisioned instance: {lakebase_name}"
                if host:
                    summary += f"\n  {host}/lakebase/provisioned/{lakebase_name}"
            else:
                project = lakebase_config["project"]
                branch = lakebase_config["branch"]
                summary += f"\n\n✓ Lakebase autoscaling instance: {project} (branch: {branch})"

        summary += "\nNext step: Run 'uv run start-app' to start the agent locally\n"
        print(summary)

    except KeyboardInterrupt:
        print("\n\nSetup cancelled.")
        sys.exit(1)


if __name__ == "__main__":
    main()
