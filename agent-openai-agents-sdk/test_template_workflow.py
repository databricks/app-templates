#!/usr/bin/env python3
"""
Test script for agent template workflow using Claude Agent SDK.

This script:
1. Creates a temporary directory
2. Instantiates the agent template
3. Runs Claude with a prompt to build/deploy an agent
4. Monitors what steps Claude takes
5. Validates that Claude follows the expected workflow (discover-tools, quickstart, etc.)
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import List, Dict, Any

try:
    from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, ResultMessage, ToolUseBlock, ToolResultBlock
except ImportError as e:
    print("ERROR: claude-agent-sdk not installed or import failed")
    print(f"Error: {e}")
    print("Install with: pip install claude-agent-sdk")
    sys.exit(1)


@dataclass
class WorkflowStep:
    """Represents a step in the expected workflow"""
    name: str
    description: str
    tool_patterns: List[str]  # Patterns to match tool usage
    required: bool = True


# Expected workflow steps
EXPECTED_WORKFLOW = [
    WorkflowStep(
        name="read_agents_md",
        description="Read AGENTS.md for guidance",
        tool_patterns=["Read.*AGENTS.md"],
        required=True
    ),
    WorkflowStep(
        name="run_quickstart",
        description="Run quickstart.sh to set up environment",
        tool_patterns=["Bash.*quickstart.sh", "Bash.*./scripts/quickstart.sh"],
        required=True
    ),
    WorkflowStep(
        name="verify_env_local",
        description="Check .env.local was created",
        tool_patterns=["Read.*\\.env\\.local", "Bash.*cat.*\\.env\\.local"],
        required=False
    ),
    WorkflowStep(
        name="read_agent_py",
        description="Read agent.py to understand baseline",
        tool_patterns=["Read.*agent.py"],
        required=False
    ),
    WorkflowStep(
        name="check_databricks_yml",
        description="Review databricks.yml configuration",
        tool_patterns=["Read.*databricks.yml"],
        required=False
    ),
]


class WorkflowValidator:
    """Validates that Claude follows the expected workflow"""

    def __init__(self):
        self.tool_calls: List[Dict[str, Any]] = []
        self.steps_completed: Dict[str, bool] = {step.name: False for step in EXPECTED_WORKFLOW}
        self.messages: List[str] = []

    def record_tool_call(self, tool_name: str, tool_input: Dict[str, Any]):
        """Record a tool call for later analysis"""
        self.tool_calls.append({
            "tool": tool_name,
            "input": tool_input
        })

        # Check if this tool call matches any expected workflow step
        for step in EXPECTED_WORKFLOW:
            for pattern in step.tool_patterns:
                import re
                # Create a regex pattern from the tool pattern
                tool_signature = f"{tool_name}"
                if tool_input:
                    # Add relevant input parameters to signature
                    if "file_path" in tool_input:
                        tool_signature += f" {tool_input['file_path']}"
                    elif "command" in tool_input:
                        tool_signature += f" {tool_input['command']}"

                if re.search(pattern, tool_signature, re.IGNORECASE):
                    self.steps_completed[step.name] = True
                    print(f"✓ Completed workflow step: {step.name} - {step.description}")
                    break

    def record_message(self, message: str):
        """Record Claude's reasoning"""
        self.messages.append(message)

    def get_report(self) -> Dict[str, Any]:
        """Generate a validation report"""
        required_steps = [step for step in EXPECTED_WORKFLOW if step.required]
        required_completed = sum(1 for step in required_steps if self.steps_completed[step.name])

        return {
            "total_tool_calls": len(self.tool_calls),
            "workflow_steps": {
                step.name: {
                    "completed": self.steps_completed[step.name],
                    "required": step.required,
                    "description": step.description
                }
                for step in EXPECTED_WORKFLOW
            },
            "required_steps_completed": required_completed,
            "required_steps_total": len(required_steps),
            "success": required_completed == len(required_steps),
            "tool_calls": self.tool_calls[:10],  # First 10 for brevity
        }


async def create_test_project(template_root: Path) -> Path:
    """Create a temporary project with the agent template"""
    temp_dir = Path(tempfile.mkdtemp(prefix="agent_template_test_"))
    print(f"Created test directory: {temp_dir}")

    try:
        # Use databricks bundle init with the template
        print(f"Initializing agent template from: {template_root}")
        result = subprocess.run(
            [
                "databricks", "bundle", "init",
                str(template_root),  # Point to template root directory (with schema.json)
                "--output-dir", str(temp_dir),
                "--config-file", "/dev/stdin"
            ],
            input=json.dumps({
                "project_name": "test_agent"
            }).encode(),
            capture_output=True,
            text=False
        )

        if result.returncode != 0:
            print(f"ERROR: Failed to initialize template")
            print(f"stdout: {result.stdout.decode()}")
            print(f"stderr: {result.stderr.decode()}")
            raise RuntimeError("Template initialization failed")

        project_dir = temp_dir / "test_agent"
        print(f"✓ Template initialized at: {project_dir}")

        return project_dir

    except Exception as e:
        print(f"ERROR creating test project: {e}")
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise


async def run_agent_test(project_dir: Path, prompt: str) -> WorkflowValidator:
    """Run Claude agent with a test prompt and monitor workflow"""
    validator = WorkflowValidator()

    print("\n" + "="*80)
    print("STARTING AGENT TEST")
    print("="*80)
    print(f"Prompt: {prompt}")
    print("="*80 + "\n")

    try:
        # Run agent in the project directory
        async for message in query(
            prompt=prompt,
            options=ClaudeAgentOptions(
                cwd=str(project_dir),
                allowed_tools=["Read", "Glob", "Grep", "Bash", "Edit", "Write"],
                permission_mode="acceptEdits",  # Auto-approve edits for testing
                system_prompt="""You are helping test a Databricks agent template.
Follow the workflow documented in AGENTS.md carefully.
Be sure to read AGENTS.md first, then run the quickstart script."""
            )
        ):
            # Handle different message types
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if hasattr(block, "text") and block.text:
                        # Claude's reasoning
                        print(f"[Reasoning] {block.text[:200]}...")
                        validator.record_message(block.text)
                    elif isinstance(block, ToolUseBlock):
                        # Tool being called
                        tool_name = block.name
                        tool_input = block.input if hasattr(block, "input") else {}
                        print(f"[Tool Call] {tool_name}")
                        if tool_input:
                            print(f"  Input: {json.dumps(tool_input, indent=2)[:200]}...")
                        validator.record_tool_call(tool_name, tool_input)

            elif isinstance(message, ResultMessage):
                # Final result
                print(f"\n[Result] {message.subtype}")
                break

    except KeyboardInterrupt:
        print("\n[Interrupted by user]")
    except Exception as e:
        print(f"\n[Error] {e}")
        import traceback
        traceback.print_exc()

    return validator


async def main():
    """Main test flow"""
    # Get the template path (root directory with databricks_template_schema.json)
    script_dir = Path(__file__).parent

    # Check for schema file
    schema_file = script_dir / "databricks_template_schema.json"
    if not schema_file.exists():
        print(f"ERROR: Template schema not found at {schema_file}")
        sys.exit(1)

    print("="*80)
    print("AGENT TEMPLATE WORKFLOW TEST")
    print("="*80)
    print(f"Template directory: {script_dir}")
    print("="*80 + "\n")

    # Test prompt
    test_prompt = """Can you help me set up this agent project following the AGENTS.md guide?

I want to get the local development environment working first.
Please follow the setup guide step by step."""

    project_dir = None
    try:
        # Create test project
        project_dir = await create_test_project(script_dir)

        # Run agent test
        validator = await run_agent_test(project_dir, test_prompt)

        # Print report
        print("\n" + "="*80)
        print("WORKFLOW VALIDATION REPORT")
        print("="*80)

        report = validator.get_report()

        print(f"\nTotal tool calls: {report['total_tool_calls']}")
        print(f"\nWorkflow steps:")
        for step_name, step_info in report['workflow_steps'].items():
            status = "✓" if step_info['completed'] else "✗"
            required = "[REQUIRED]" if step_info['required'] else "[OPTIONAL]"
            print(f"  {status} {required} {step_name}: {step_info['description']}")

        print(f"\nRequired steps: {report['required_steps_completed']}/{report['required_steps_total']}")

        if report['success']:
            print("\n✓ SUCCESS: Agent followed the expected workflow!")
        else:
            print("\n✗ FAILURE: Agent did not complete all required workflow steps")
            print("\nMissing required steps:")
            for step_name, step_info in report['workflow_steps'].items():
                if step_info['required'] and not step_info['completed']:
                    print(f"  - {step_name}: {step_info['description']}")

        # Save detailed report
        report_path = Path("workflow_test_report.json")
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nDetailed report saved to: {report_path}")

        print("\n" + "="*80)

        return 0 if report['success'] else 1

    finally:
        # Cleanup
        if project_dir and project_dir.exists():
            print(f"\nTest project available at: {project_dir}")
            print("(Temporary directory not deleted for inspection)")
            # Uncomment to auto-delete:
            # shutil.rmtree(project_dir.parent, ignore_errors=True)


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
