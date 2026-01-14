#!/usr/bin/env python3
"""
Iterative template documentation improvement script.

This script:
1. Runs the template workflow test
2. Analyzes what Claude did vs. what was expected
3. Uses Claude to suggest improvements to AGENTS.md
4. Applies improvements and commits them
5. Repeats until workflow is followed correctly
"""

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any

try:
    from claude_agent_sdk import query, ClaudeAgentOptions
except ImportError:
    print("ERROR: claude-agent-sdk not installed")
    print("Install with: pip install claude-agent-sdk")
    sys.exit(1)

# Import the test script
import test_template_workflow


async def analyze_test_results(report: Dict[str, Any]) -> str:
    """Generate a detailed analysis of what went wrong"""
    analysis = []

    analysis.append("# Test Results Analysis\n")

    # Overall status
    if report['success']:
        analysis.append("✓ Test PASSED: Agent followed expected workflow\n")
        return "\n".join(analysis)

    analysis.append("✗ Test FAILED: Agent did not follow expected workflow\n")

    # Missing steps
    analysis.append("\n## Missing Required Steps\n")
    missing_steps = []
    for step_name, step_info in report['workflow_steps'].items():
        if step_info['required'] and not step_info['completed']:
            missing_steps.append(f"- **{step_name}**: {step_info['description']}")

    if missing_steps:
        analysis.extend(missing_steps)
    else:
        analysis.append("(None - all required steps completed)")

    # Completed steps
    analysis.append("\n## Completed Steps\n")
    completed_steps = []
    for step_name, step_info in report['workflow_steps'].items():
        if step_info['completed']:
            completed_steps.append(f"- ✓ {step_name}: {step_info['description']}")

    if completed_steps:
        analysis.extend(completed_steps)
    else:
        analysis.append("(None)")

    # Tool usage summary
    analysis.append(f"\n## Tool Usage Summary\n")
    analysis.append(f"Total tool calls: {report['total_tool_calls']}\n")

    if report.get('tool_calls'):
        analysis.append("\nFirst 10 tool calls:")
        for i, call in enumerate(report['tool_calls'][:10], 1):
            analysis.append(f"{i}. {call['tool']}")
            if call.get('input'):
                if 'file_path' in call['input']:
                    analysis.append(f"   - file: {call['input']['file_path']}")
                elif 'command' in call['input']:
                    analysis.append(f"   - command: {call['input']['command'][:100]}")

    return "\n".join(analysis)


async def suggest_improvements(analysis: str, agents_md_content: str) -> str:
    """Use Claude to suggest improvements to AGENTS.md"""
    print("\n" + "="*80)
    print("ASKING CLAUDE FOR DOCUMENTATION IMPROVEMENTS")
    print("="*80 + "\n")

    prompt = f"""I'm testing a Databricks agent template that helps users build agents.
The template includes an AGENTS.md file with setup instructions.

I ran a test where Claude tried to help a user "set up an agent project"
but Claude didn't follow the expected workflow.

## Test Results

{analysis}

## Current AGENTS.md Content

```markdown
{agents_md_content}
```

## Your Task

Based on the test results, suggest specific improvements to AGENTS.md that would help
Claude follow the expected workflow. Focus on:

1. Making critical steps more prominent (e.g., quickstart.sh, reading AGENTS.md first)
2. Clarifying the order of operations
3. Adding stronger directives (e.g., "MUST run X before Y")
4. Improving visibility of key sections
5. Making the "For AI Agents" sections more prominent and actionable

Provide your suggestions as a bulleted list of specific, actionable changes.
"""

    suggestions = []

    async for message in query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Grep"],
            permission_mode="default"  # Read-only analysis
        )
    ):
        if hasattr(message, 'content'):
            for block in message.content:
                if hasattr(block, 'text'):
                    suggestions.append(block.text)

    return "\n".join(suggestions)


async def apply_improvements(suggestions: str, template_dir: Path) -> bool:
    """Apply suggested improvements to AGENTS.md"""
    print("\n" + "="*80)
    print("SUGGESTED IMPROVEMENTS")
    print("="*80)
    print(suggestions)
    print("="*80 + "\n")

    # Ask user if they want to apply
    response = input("Apply these improvements? (y/n): ").strip().lower()

    if response != 'y':
        print("Skipping improvements.")
        return False

    # Use Claude to apply the improvements
    agents_md_path = template_dir / "template" / "{{.project_name}}" / "AGENTS.md"

    prompt = f"""Please apply the following improvements to AGENTS.md:

{suggestions}

Current AGENTS.md is at: {agents_md_path}

Make the changes directly to the file."""

    async for message in query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            cwd=str(template_dir),
            allowed_tools=["Read", "Edit"],
            permission_mode="acceptEdits"
        )
    ):
        if hasattr(message, 'content'):
            for block in message.content:
                if hasattr(block, 'text'):
                    print(block.text)

    return True


async def commit_changes(template_dir: Path, iteration: int):
    """Commit the changes"""
    commit_message = f"""Iterate on AGENTS.md documentation (iteration {iteration})

Improved workflow guidance based on Claude Agent SDK testing.
Changes aim to make critical steps more visible and workflow clearer."""

    try:
        subprocess.run(
            ["git", "add", "template/{{.project_name}}/AGENTS.md"],
            cwd=template_dir,
            check=True
        )

        subprocess.run(
            ["git", "commit", "-m", commit_message],
            cwd=template_dir,
            check=True
        )

        print(f"✓ Committed changes (iteration {iteration})")
        return True

    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to commit: {e}")
        return False


async def main():
    """Main iteration loop"""
    template_dir = Path(__file__).parent
    agents_md_path = template_dir / "template" / "{{.project_name}}" / "AGENTS.md"

    max_iterations = 5
    iteration = 0

    print("="*80)
    print("ITERATIVE TEMPLATE DOCUMENTATION IMPROVEMENT")
    print("="*80)
    print(f"Max iterations: {max_iterations}")
    print("="*80 + "\n")

    while iteration < max_iterations:
        iteration += 1

        print(f"\n{'='*80}")
        print(f"ITERATION {iteration}/{max_iterations}")
        print('='*80 + "\n")

        # Run the test
        print("Running workflow test...")
        exit_code = await test_template_workflow.main()

        # Load the report
        report_path = Path("workflow_test_report.json")
        if not report_path.exists():
            print("ERROR: Test report not found")
            break

        with open(report_path) as f:
            report = json.load(f)

        # Check if test passed
        if report['success']:
            print("\n" + "="*80)
            print("SUCCESS! Agent follows expected workflow.")
            print("="*80)
            break

        # Analyze results
        analysis = await analyze_test_results(report)
        print("\n" + analysis)

        # Get improvement suggestions
        with open(agents_md_path) as f:
            agents_md_content = f.read()

        suggestions = await suggest_improvements(analysis, agents_md_content)

        # Apply improvements
        if await apply_improvements(suggestions, template_dir):
            # Commit changes
            await commit_changes(template_dir, iteration)
        else:
            print("Stopping iteration.")
            break

        # Ask if user wants to continue
        if iteration < max_iterations:
            response = input("\nRun another iteration? (y/n): ").strip().lower()
            if response != 'y':
                break

    print("\n" + "="*80)
    print("ITERATION COMPLETE")
    print("="*80)
    print(f"Total iterations: {iteration}")


if __name__ == "__main__":
    asyncio.run(main())
