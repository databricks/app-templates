---
name: agent-evaluation
description: Use this when you need to EVALUATE an existing LLM agent's performance - including task completion rate, sub-goal success rate, tool selection accuracy, answer quality, self-correction, safety, cost, and efficiency. Evaluates agents systematically using MLflow evaluation with datasets, scorers, and tracing. Covers end-to-end evaluation workflow or individual components (tracing setup, dataset creation, scorer definition, evaluation execution).
allowed-tools: Read, Write, Bash, Grep, Glob, WebFetch
---

# Agent Evaluation with MLflow

Comprehensive guide for evaluating GenAI agents with MLflow. Use this skill for the complete evaluation workflow or individual components - tracing setup, environment configuration, dataset creation, scorer definition, or evaluation execution. Each section can be used independently based on your needs.

## Table of Contents

1. [Evaluation Overview](#evaluation-overview)
2. [Command Conventions](#command-conventions)
3. [Pre-Flight Validation](#pre-flight-validation)
4. [Documentation Access Protocol](#documentation-access-protocol)
5. [Discovering Agent Server Structure](#discovering-agent-server-structure)
6. [Verify Current Agent](#verify-current-agent)
7. [Evaluation Workflow](#evaluation-workflow)

## Evaluation Overview

**Setup (prerequisite)**: Install MLflow 3.8+, configure environment, integrate tracing

1. **Understand**: Understand agent purpose and strategy
2. **Dataset**: Agent dataset discovery
3. **Define**: Select and create scorers for quality criteria
4. **Evaluate**: Run agent on dataset, apply scorers, analyze results
5. **Record**: Save evaluation procedure for reference, tracking, and history

## Command Conventions

**Always use `uv run` for MLflow and Python commands:**

```bash
uv run mlflow --version          # MLflow CLI commands
uv run python scripts/xxx.py     # Python script execution
uv run python -c "..."           # Python one-liners
```

This ensures commands run in the correct environment with proper dependencies.

**CRITICAL: Separate stderr from stdout when capturing CLI output:**

When saving CLI command output to files for parsing (JSON, CSV, etc.), always redirect stderr separately to avoid mixing logs with structured data:

```bash
# WRONG - mixes progress bars and logs with JSON output
uv run mlflow traces evaluate ... --output json > results.json

# CORRECT - separates stderr from JSON output
uv run mlflow traces evaluate ... --output json 2>/dev/null > results.json

# ALTERNATIVE - save both separately for debugging
uv run mlflow traces evaluate ... --output json > results.json 2> evaluation.log
```

**When to separate streams:**
- Any command with `--output json` flag
- Commands that output structured data (CSV, JSON, XML)
- When piping output to parsing tools (`jq`, `grep`, etc.)

**When NOT to separate:**
- Interactive commands where you want to see progress
- Debugging scenarios where logs provide context
- Commands that only output unstructured text

## Pre-Flight Validation

Validate environment before starting:

```bash
uv run mlflow --version  # Should be >=3.8.0
uv run python -c "import mlflow; print(f'MLflow {mlflow.__version__} installed')"
```

If MLflow is missing or version is <3.8.0, see Setup overview here `references/setup-guide`

## Documentation Access Protocol

**CRITICAL: All MLflow documentation must be accessed through llms.txt:**

1. Start at: `https://mlflow.org/docs/latest/llms.txt`
2. Query `llms.txt` for your topic with specific prompt
3. If `llms.txt` references another doc, use WebFetch with that URL
4. Do not use WebSearch - use WebFetch with llms.txt first

**This applies to all steps**, especially:

- Dataset creation (read GenAI dataset docs from llms.txt)
- Scorer registration (check MLflow docs for scorer APIs)
- Evaluation execution (understand mlflow.genai.evaluate API)

## Verify Current Agent

Complete two verification steps:

1. **Environment Check** (tracking URI and experiment)
2. **Integrate tracing** (autolog and @mlflow.trace decorators)
   - ⚠️ **MANDATORY**: Read `references/tracing-integration.md` documentation and implement any changes
   - ✓ **VERIFY**: Run `scripts/validate_agent_tracing.py` to validate work

⚠️ **Tracing must work before evaluation.** If tracing fails, stop and troubleshoot.

**Checkpoint - verify before proceeding:**

- [ ] MLflow >=3.8.0 installed
- [ ] MLFLOW_TRACKING_URI and MLFLOW_EXPERIMENT_ID set
- [ ] Autolog enabled and @mlflow.trace decorators added
- [ ] Test run creates a trace (verify trace ID is not None) 

## Evaluation Workflow

### Step 1: Understand Agent Purpose

1. Run `references/agent-strategy.md` then continue evaluation from here
2. Inspect MLflow trace (especially LLM prompts describing agent purpose)
3. Print your understanding and ask user for verification
4. **Wait for confirmation before proceeding**

## Step 2: Evaluation Dataset and Ground Truth

Ask the user:

"Would you like to create a ground truth evaluation dataset?

**Benefits of a ground truth dataset:**
- Enables **Correctness** scoring (comparing against expected answers)
- Enables **RetrievalSufficiency** scoring (for RAG agents)
- Enables **Guidelines** and **ExpectationsGuidelines** scoring (adherence to guidelines and expectations)
- Enables **Equivalence** scoring (reponse agrees with predicted response)
- Provides consistent, repeatable evaluation baselines
- Allows tracking improvement over time

**Options:**
1. **Yes** - I'll guide you through creating a synthetic dataset relevant to your use case. 
2. **No** - Proceed with scorers that don't require ground truth"

### If User Says YES (Create Evaluation Dataset Step 4):
### If User Says NO (Warn User and Skip to Step 5):

No Ground Truth Dataset Warning:

"**Important Note:** While you can evaluate without ground truth, having a ground truth dataset significantly improves evaluation quality. You'll be limited to scorers that assess general quality rather than correctness against expected answers. Consider creating even a small ground truth dataset (10-15 examples) for your most critical use cases.

Proceeding with scorers that don't require ground truth..."

## Step 3: Prepare Evaluation Dataset

**ALWAYS discover existing datasets first** to prevent duplicate work:
**IMPORTANT**: Do not skip dataset discovery. Always run `list_datasets.py` first, even if you plan to create a new dataset. This prevents duplicate work and ensures users are aware of existing evaluation datasets.
**IMPORTANT**: Ask user wether the dataset should be local, UC, or both.

**For complete dataset guide:** See `references/dataset-preparation.md`

1. **Run dataset discovery** (mandatory):

   ```bash
   uv run python scripts/list_datasets.py  # Lists all datasets as table
   uv run python scripts/list_datasets.py --format json  # For machine-readable output
   ```

2. **Present findings to user**:

   - Show all discovered datasets with their characteristics (size, topics covered)
   - If datasets found, highlight most relevant options based on agent type

3. **Ask user about existing datasets**:

   - "I found [N] existing evaluation dataset(s). Do you want to use one of these? (y/n)"
   - If yes: Ask which dataset to use and record the dataset name
   - If no: Proceed to step 5

4. **Create new dataset only if user declined existing ones or No existing datasets found**:
  - Prompt user to name test cases file
  - Prompt user for number of test cases to create
  - Write results file in `agent_server/evaluation/test_cases/`
  
   ```bash
   uv run python scripts/create_dataset_template.py --test-cases-file <path to test cases file>
   # Optional: --dataset-name my-eval --catalog main --schema ml --table eval_v1
   ```
   Review and execute the generated script.

### Step 4: Create and Run Evaluation

**Coding Support** 
- For coding patterns see `skills/agent-evaluation/patterns/`:

| Reference | Purpose | When to Read |
|-----------|---------|--------------|
| `GOTCHAS.md` | Common mistakes | **Always read first** before writing code |
| `CRITICAL-interfaces.md` | API signatures, schemas |  **Always read first** When writing any evaluation code |
| `patterns-evaluation.md` | Running evals, comparing | When executing evaluations |
| `patterns-scorers.md` | Custom scorer creation | When built-in scorers aren't enough |
| `patterns-datasets.md` | Dataset building | When preparing evaluation data |

**Reference** If it exits, check `agent_server/evaluation/reports/agent_strategy.md` for scorers
**For scorer selection and registration:** See `references/scorers.md`
**For CLI constraints (yes/no format, template variables):** See `references/scorers-constraints.md`

1. Generate evaluation script:
  - Write output to `agent_server/evaluate_agent.py`
   
   ```bash
   uv run python scripts/run_evaluation_template.py  # Auto-detects module, entry point, dataset
   # Optional: --module my_agent.agent --entry-point run_agent --dataset-name my-dataset
  
   ```
  Review and execute the generated script.

2. Apply scorers:
  - Prompt user to name scorers results .json file
  - Write scorers results .json file to `agent_server/evaluation/results/`
   
   ```bash
   # IMPORTANT: Redirect stderr to avoid mixing logs with JSON output
   uv run mlflow traces evaluate \
     --trace-ids <comma_separated_trace_ids> \
     --scorers <scorer1>,<scorer2>,... \
     --output json 2>/dev/null > <path to results .json file>
   ```

3. Analyze scorers results:
  - Prompt user to name scorer analysis report file
  - Write results file to `agent_server/evaluation/reports/`

   ```bash
   uv run python scripts/analyze_results.py <path to results .json file> --output <path to scorer analysis report>
   ```
   Generates scorer analysis report with pass rates, failure patterns, and recommendations.