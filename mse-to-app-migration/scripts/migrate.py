#!/usr/bin/env python3
"""
Model Serving Endpoint Artifact Downloader

This script downloads the original agent code from a Databricks Model Serving endpoint
to help with migration to Databricks Apps.

Usage:
    uv run migrate --endpoint <endpoint-name> [OPTIONS]

Options:
    --endpoint NAME       Model serving endpoint name (required)
    --output PATH         Output directory (default: ./output)
    --profile NAME        Databricks CLI profile to use
    --host URL            Databricks workspace URL
    --token TOKEN         Databricks access token (or use DATABRICKS_TOKEN env var)
    -h, --help            Show this help message

After downloading, use the AGENTS.md instructions with an LLM coding agent
to complete the migration.
"""

import argparse
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Optional


def print_header(text: str) -> None:
    print(f"\n{'=' * 67}")
    print(text)
    print("=" * 67)


def print_step(text: str) -> None:
    print(f"\n>> {text}")


def print_success(text: str) -> None:
    print(f"   [OK] {text}")


def print_error(text: str) -> None:
    print(f"   [ERROR] {text}", file=sys.stderr)


def print_info(text: str) -> None:
    print(f"   {text}")


def get_workspace_client(host: str, token: str, profile: Optional[str] = None):
    """Get authenticated Databricks WorkspaceClient."""
    from databricks.sdk import WorkspaceClient

    if token:
        return WorkspaceClient(host=host, token=token)
    elif profile:
        return WorkspaceClient(profile=profile)
    else:
        # Try default authentication
        return WorkspaceClient()


def get_endpoint_info(client, endpoint_name: str) -> dict:
    """Get model serving endpoint information."""
    print_step(f"Getting endpoint info for '{endpoint_name}'...")

    try:
        endpoint = client.serving_endpoints.get(endpoint_name)
    except Exception as e:
        print_error(f"Failed to get endpoint: {e}")
        raise

    # Extract model info from served entities
    if not endpoint.config or not endpoint.config.served_entities:
        raise ValueError("No served entities found in endpoint")

    entity = endpoint.config.served_entities[0]
    model_name = entity.entity_name
    model_version = entity.entity_version

    print_success(f"Found model: {model_name} (version {model_version})")

    return {
        "model_name": model_name,
        "model_version": model_version,
        "model_uri": f"models:/{model_name}/{model_version}",
    }


def download_artifacts(model_uri: str, output_dir: Path, profile: Optional[str] = None) -> Path:
    """Download MLflow model artifacts."""
    import mlflow

    print_step(f"Downloading artifacts from {model_uri}...")

    # Set up MLflow tracking
    if profile:
        mlflow.set_tracking_uri(f"databricks://{profile}")
    else:
        mlflow.set_tracking_uri("databricks")

    # Download to temp dir first, then move
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            downloaded_path = mlflow.artifacts.download_artifacts(
                artifact_uri=model_uri,
                dst_path=temp_dir,
            )
            print_success(f"Downloaded to temp location")

            # Move to output directory
            artifact_dest = output_dir / "original_model"
            if artifact_dest.exists():
                shutil.rmtree(artifact_dest)
            shutil.copytree(downloaded_path, artifact_dest)
            print_success(f"Saved to {artifact_dest}")

            return artifact_dest

        except Exception as e:
            print_error(f"Failed to download artifacts: {e}")
            raise


def analyze_agent(artifact_path: Path) -> dict:
    """Analyze the downloaded agent to detect its type."""
    print_step("Analyzing agent code...")

    analysis = {
        "detected_type": "stateless",
        "llm_endpoint": None,
        "system_prompt": None,
        "agent_files": [],
    }

    # Find Python files
    code_path = artifact_path / "code"
    if code_path.exists():
        py_files = list(code_path.rglob("*.py"))
    else:
        py_files = list(artifact_path.glob("*.py"))

    for py_file in py_files:
        analysis["agent_files"].append(str(py_file.name))

        with open(py_file) as f:
            content = f.read()

        # Detect agent type
        if "checkpointer" in content.lower() or "asynccheckpointsaver" in content.lower():
            analysis["detected_type"] = "short-term"
            print_info("Detected: Short-term memory agent (uses checkpointer)")
        elif "databricksstore" in content.lower() or "asyncdatabricksstore" in content.lower():
            analysis["detected_type"] = "long-term"
            print_info("Detected: Long-term memory agent (uses store)")

        # Extract LLM endpoint
        match = re.search(r'LLM_ENDPOINT_NAME\s*=\s*["\']([^"\']+)["\']', content)
        if match and not analysis["llm_endpoint"]:
            analysis["llm_endpoint"] = match.group(1)
            print_info(f"LLM endpoint: {analysis['llm_endpoint']}")

        # Try alternative pattern
        if not analysis["llm_endpoint"]:
            match = re.search(r'ChatDatabricks\s*\(\s*endpoint\s*=\s*["\']([^"\']+)["\']', content)
            if match:
                analysis["llm_endpoint"] = match.group(1)
                print_info(f"LLM endpoint: {analysis['llm_endpoint']}")

        # Extract system prompt
        if not analysis["system_prompt"]:
            match = re.search(r'SYSTEM_PROMPT\s*=\s*(?:"""|\'\'\')(.*?)(?:"""|\'\'\')', content, re.DOTALL)
            if match:
                analysis["system_prompt"] = match.group(1).strip()[:100] + "..."
                print_info(f"System prompt found")

    if analysis["detected_type"] == "stateless":
        print_info("Detected: Stateless agent")

    return analysis


def print_next_steps(output_dir: Path, analysis: dict):
    """Print guidance for the LLM agent."""
    print_header("Download Complete!")

    print(f"""
Your original agent code has been downloaded to:
  {output_dir}/original_model/

Agent Analysis:
  Type: {analysis['detected_type']}
  LLM Endpoint: {analysis['llm_endpoint'] or 'Not detected'}
  Files: {', '.join(analysis['agent_files']) or 'None found'}

Next Steps:
-----------
1. Use an LLM coding agent (Claude Code, Cursor, etc.) with the AGENTS.md file
2. Ask the agent to migrate your endpoint, for example:

   "Migrate the agent in ./output/original_model/ to a Databricks App.
    The original agent uses {analysis['detected_type']} memory."

3. The agent will:
   - Clone the appropriate template from https://github.com/databricks/app-templates
   - Refactor the code to use @invoke/@stream decorators
   - Set up the app structure

Recommended template based on detected type:
""")

    if analysis["detected_type"] == "short-term":
        print("  -> agent-langgraph-short-term-memory")
    elif analysis["detected_type"] == "long-term":
        print("  -> agent-langgraph-long-term-memory")
    else:
        print("  -> agent-langgraph")

    print()


def main():
    parser = argparse.ArgumentParser(
        description="Download Model Serving endpoint artifacts for migration",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  uv run migrate --endpoint my-agent --profile DEFAULT
  uv run migrate --endpoint my-agent --host https://workspace.databricks.com --token dapi...
        """,
    )
    parser.add_argument("--endpoint", required=True, help="Model serving endpoint name")
    parser.add_argument("--output", default="./output", help="Output directory")
    parser.add_argument("--profile", help="Databricks CLI profile")
    parser.add_argument("--host", help="Databricks workspace URL")
    parser.add_argument("--token", help="Databricks access token")

    args = parser.parse_args()

    # Get token from env if not provided
    token = args.token or os.environ.get("DATABRICKS_TOKEN", "")
    host = args.host or os.environ.get("DATABRICKS_HOST", "")

    if not token and not args.profile:
        print_error("Either --profile or --token (or DATABRICKS_TOKEN env var) is required")
        sys.exit(1)

    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    print_header("Model Serving Artifact Downloader")
    print_info(f"Endpoint: {args.endpoint}")
    print_info(f"Output: {output_dir}")

    try:
        # Get endpoint info
        client = get_workspace_client(host, token, args.profile)
        endpoint_info = get_endpoint_info(client, args.endpoint)

        # Download artifacts
        artifact_path = download_artifacts(
            endpoint_info["model_uri"],
            output_dir,
            args.profile,
        )

        # Analyze the agent
        analysis = analyze_agent(artifact_path)

        # Print next steps
        print_next_steps(output_dir, analysis)

    except Exception as e:
        print_error(f"Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
