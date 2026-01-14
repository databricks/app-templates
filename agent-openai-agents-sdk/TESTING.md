# Agent Template Testing Guide

This directory contains automated testing scripts for validating the agent template workflow using the Claude Agent SDK.

## Overview

The testing framework validates that:
1. The AGENTS.md documentation is clear and actionable
2. Claude can follow the documented workflow when helping users
3. Critical steps (quickstart, setup) are properly highlighted

## Prerequisites

Install the Claude Agent SDK:

```bash
pip install claude-agent-sdk
```

## Test Scripts

### `test_template_workflow.py`

**Purpose:** Tests whether Claude follows the expected workflow when helping a user set up an agent.

**What it does:**
1. Creates a temporary directory
2. Instantiates the agent template using `databricks bundle init`
3. Launches a Claude Agent SDK session with the prompt: "Can you help me set up this agent project following the AGENTS.md guide?"
4. Monitors what Claude does (which files it reads, which commands it runs)
5. Validates that Claude follows the expected workflow steps:
   - ✅ Reads AGENTS.md for guidance
   - ✅ Runs quickstart.sh to set up environment
   - ✅ Verifies .env.local was created
   - ✅ Reviews agent.py and databricks.yml

**Run the test:**

```bash
cd ~/app-templates/agent-openai-agents-sdk
python test_template_workflow.py
```

**Output:**
- Console output showing Claude's actions in real-time
- `workflow_test_report.json` with detailed validation results
- Exit code 0 if test passes, 1 if it fails

### `iterate_template_docs.py`

**Purpose:** Iteratively improves AGENTS.md documentation based on test failures.

**What it does:**
1. Runs `test_template_workflow.py`
2. If the test fails, analyzes what went wrong
3. Uses Claude to suggest improvements to AGENTS.md
4. Prompts user to review and apply improvements
5. Commits changes
6. Repeats until the test passes (max 5 iterations)

**Run the iteration:**

```bash
cd ~/app-templates/agent-openai-agents-sdk
python iterate_template_docs.py
```

**Workflow:**
```
┌─────────────────────────┐
│ Run workflow test       │
└───────────┬─────────────┘
            │
            ▼
       Test passed?
            │
     ┌──────┴──────┐
     │             │
    Yes           No
     │             │
     ▼             ▼
   Done    ┌──────────────────┐
           │ Analyze failures │
           └────────┬─────────┘
                    │
                    ▼
           ┌─────────────────────┐
           │ Claude suggests     │
           │ improvements        │
           └────────┬────────────┘
                    │
                    ▼
           ┌─────────────────────┐
           │ User reviews/applies│
           └────────┬────────────┘
                    │
                    ▼
           ┌─────────────────────┐
           │ Commit changes      │
           └────────┬────────────┘
                    │
                    ▼
           ┌─────────────────────┐
           │ Repeat (max 5x)     │
           └─────────────────────┘
```

## Expected Workflow Steps

The test validates these critical steps:

| Step | Description | Required |
|------|-------------|----------|
| `read_agents_md` | Read AGENTS.md for guidance | ✅ Required |
| `run_quickstart` | Run quickstart.sh to set up environment | ✅ Required |
| `verify_env_local` | Check .env.local was created | Optional |
| `read_agent_py` | Read agent.py to understand baseline | Optional |
| `check_databricks_yml` | Review databricks.yml configuration | Optional |

## Customizing the Test

### Adding New Workflow Steps

Edit `test_template_workflow.py` and add to `EXPECTED_WORKFLOW`:

```python
WorkflowStep(
    name="my_new_step",
    description="Description of what this step does",
    tool_patterns=["Bash.*my-command", "Read.*my-file.txt"],
    required=True  # or False for optional steps
)
```

### Modifying the Test Prompt

Edit the `test_prompt` variable in `test_template_workflow.py`:

```python
test_prompt = """Your custom prompt here..."""
```

### Adjusting Tool Patterns

Tool patterns use regex to match:
- Tool name (e.g., `Bash`, `Read`, `Edit`)
- File paths or command arguments

Examples:
- `"Read.*AGENTS.md"` - Matches reading AGENTS.md
- `"Bash.*quickstart"` - Matches any bash command containing "quickstart"
- `"Edit.*agent.py"` - Matches editing agent.py

## Interpreting Results

### Test Report Structure

```json
{
  "total_tool_calls": 25,
  "workflow_steps": {
    "read_agents_md": {
      "completed": true,
      "required": true,
      "description": "Read AGENTS.md for guidance"
    },
    "run_quickstart": {
      "completed": false,
      "required": true,
      "description": "Run quickstart.sh to set up environment"
    }
  },
  "required_steps_completed": 1,
  "required_steps_total": 2,
  "success": false
}
```

### Common Failure Patterns

**Claude skips quickstart:**
- Symptom: `run_quickstart` not completed
- Likely cause: AGENTS.md doesn't emphasize quickstart strongly enough
- Fix: Add "MUST run quickstart.sh first" directive

**Claude doesn't read AGENTS.md:**
- Symptom: `read_agents_md` not completed
- Likely cause: "For AI Agents" section not prominent enough
- Fix: Add stronger heading, move to top

**Claude runs wrong commands:**
- Symptom: Tool calls don't match expected patterns
- Likely cause: Instructions unclear or conflicting
- Fix: Simplify instructions, remove ambiguity

## Best Practices

1. **Run tests after documentation changes:** Always test AGENTS.md changes
2. **Iterate until passing:** Use `iterate_template_docs.py` to improve systematically
3. **Review suggestions carefully:** Claude's suggestions may need refinement
4. **Test different prompts:** Try variations to ensure robustness
5. **Keep test updated:** Update `EXPECTED_WORKFLOW` when workflow changes

## Troubleshooting

### "claude-agent-sdk not installed"

```bash
pip install claude-agent-sdk
```

### "Template initialization failed"

Ensure `databricks` CLI is installed and in PATH:

```bash
which databricks
databricks --version
```

### Test hangs or times out

- Check if Databricks authentication is working
- Verify network connectivity
- Try increasing timeout in `ClaudeAgentOptions`

### Claude makes unexpected tool calls

- Review the system prompt in `run_agent_test()`
- Adjust tool patterns to be more specific
- Check AGENTS.md for conflicting instructions

## Reference: CLI Testing Approach

This testing framework is adapted from the approach used in the Databricks CLI repo:
- `~/cli/experimental/aitools/templates/agent-openai-agents-sdk/test_template_workflow.py`
- `~/cli/experimental/aitools/templates/agent-openai-agents-sdk/iterate_template_docs.py`

The key difference is that these scripts test the standalone template in `~/app-templates` rather than the embedded CLI template.
