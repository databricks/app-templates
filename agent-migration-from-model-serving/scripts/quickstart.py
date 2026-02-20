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
    --lakebase NAME   Lakebase instance name (for memory features)
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
    print('=' * 67)


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
    return subprocess.run(cmd, capture_output=capture_output, text=True, check=check, env=merged_env)


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
            missing.append("Databricks CLI - Install with: curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh")

    if missing:
        missing.append("Note: These install commands are for Unix/macOS. For Windows, please visit the official documentation for each tool.")

    return missing


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
    pattern = rf'^{re.escape(key)}=.*$'
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
                    profiles.append({
                        "name": parts[0],
                        "line": line,
                    })

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
            host = input("\nPlease enter your Databricks host URL\n(e.g., https://your-workspace.cloud.databricks.com): ").strip()

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
            ["databricks", "-p", profile_name, "experiments", "create-experiment",
             experiment_name, "--output", "json"],
            check=False
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
            ["databricks", "-p", profile_name, "experiments", "create-experiment",
             experiment_name, "--output", "json"]
        )
        experiment_id = json.loads(result.stdout).get("experiment_id", "")
        print_success(f"Created experiment '{experiment_name}' with ID: {experiment_id}")
        return experiment_name, experiment_id

    except Exception as e:
        print_error(f"Failed to create MLflow experiment: {e}")
        print_troubleshooting_api()
        sys.exit(1)


def check_lakebase_required() -> bool:
    """Check if app.yaml has LAKEBASE_INSTANCE_NAME configured."""
    app_yaml = Path("app.yaml")
    if not app_yaml.exists():
        return False

    content = app_yaml.read_text()
    return "LAKEBASE_INSTANCE_NAME" in content


def get_env_value(key: str) -> str:
    """Get a value from .env file."""
    env_file = Path(".env")
    if not env_file.exists():
        return ""

    content = env_file.read_text()
    pattern = rf'^{re.escape(key)}=(.*)$'
    match = re.search(pattern, content, re.MULTILINE)
    if match:
        return match.group(1).strip().strip('"').strip("'")
    return ""


def validate_lakebase_instance(profile_name: str, lakebase_name: str) -> bool:
    """Validate that the Lakebase instance exists and user has access."""
    print(f"Validating Lakebase instance '{lakebase_name}'...")

    result = run_command(
        ["databricks", "-p", profile_name, "database", "get-database-instance",
         lakebase_name, "--output", "json"],
        check=False
    )

    if result.returncode == 0:
        print_success(f"Lakebase instance '{lakebase_name}' validated")
        return True

    # Check if database command is not recognized (old CLI version)
    if 'unknown command "database" for "databricks"' in (result.stderr or ""):
        print_error("The 'databricks database' command requires a newer version of the Databricks CLI.")
        print("  Please upgrade: https://docs.databricks.com/dev-tools/cli/install.html")
        return False

    error_msg = result.stderr.lower() if result.stderr else ""
    if "not found" in error_msg:
        print_error(f"Lakebase instance '{lakebase_name}' not found. Please check the instance name.")
    elif "permission" in error_msg or "forbidden" in error_msg or "unauthorized" in error_msg:
        print_error(f"No permission to access Lakebase instance '{lakebase_name}'")
    else:
        print_error(f"Failed to validate Lakebase instance: {result.stderr.strip() if result.stderr else 'Unknown error'}")
    return False


def setup_lakebase(profile_name: str, lakebase_arg: str = None) -> str:
    """Set up Lakebase instance for memory features."""
    print_step("Setting up Lakebase instance for memory...")

    lakebase_name = None

    # If --lakebase was provided, use it directly
    if lakebase_arg:
        lakebase_name = lakebase_arg
        print(f"Using provided Lakebase instance: {lakebase_name}")
    else:
        # Check if already set in .env
        existing = get_env_value("LAKEBASE_INSTANCE_NAME")
        if existing:
            print(f"Found existing Lakebase instance in .env: {existing}")
            new_value = input("Press Enter to keep this value, or enter a new instance name: ").strip()
            lakebase_name = new_value if new_value else existing
        else:
            # Interactive mode - prompt for instance name
            lakebase_name = input("Please enter your Lakebase instance name: ").strip()

            if not lakebase_name:
                print_error("Lakebase instance name is required for memory features")
                sys.exit(1)

    # Validate that the Lakebase instance exists and user has access
    if not validate_lakebase_instance(profile_name, lakebase_name):
        sys.exit(1)

    # Update .env with the Lakebase instance name
    update_env_file("LAKEBASE_INSTANCE_NAME", lakebase_name)
    print_success(f"Lakebase instance name '{lakebase_name}' saved to .env")

    return lakebase_name


def main():
    parser = argparse.ArgumentParser(
        description="Quickstart setup for Databricks agent development",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    uv run quickstart                    # Interactive setup
    uv run quickstart --profile DEFAULT  # Use existing profile (non-interactive)
    uv run quickstart --host https://...  # Set up new profile with host
    uv run quickstart --lakebase my-db   # Include Lakebase setup for memory
        """
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
        "--lakebase",
        help="Lakebase instance name (for memory features)",
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

        # Step 6: Lakebase setup (if needed for memory features)
        lakebase_name = None
        lakebase_required = args.lakebase or check_lakebase_required()
        if lakebase_required:
            lakebase_name = setup_lakebase(profile_name, args.lakebase)

        # Final summary
        print_header("Setup Complete!")
        summary = f"""
✓ Prerequisites verified (uv, Node.js, Databricks CLI)
✓ Databricks authenticated with profile: {profile_name}
✓ Configuration files created (.env)
✓ MLflow experiment created: {experiment_name}
✓ Experiment ID: {experiment_id}"""

        if lakebase_name:
            summary += f"\n✓ Lakebase instance: {lakebase_name}"

        summary += """

Next step: Run 'uv run start-app' to start the agent locally
"""
        print(summary)

    except KeyboardInterrupt:
        print("\n\nSetup cancelled.")
        sys.exit(1)


if __name__ == "__main__":
    main()
