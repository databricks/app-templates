---
name: agent-evaluation
description: Use this when you need to CREATE, IMPROVE or OPTIMIZE an existing LLM agent - including tool selection accuracy, answer quality, reducing costs, or fixing issues where the agent gives wrong/incomplete responses. Evaluates agents systematically using MLflow evaluation with datasets, scorers, and tracing. Covers end-to-end evaluation workflow or individual components (tracing setup, dataset creation, scorer definition, evaluation execution).
allowed-tools: Read, Write, Bash, Grep, Glob, WebFetch
---

# Agent Evaluation with MLflow

Comprehensive guide for evaluating GenAI agents with MLflow. Use this skill for the complete evaluation workflow or individual components - tracing setup, environment configuration, dataset creation, scorer definition, or evaluation execution. Each section can be used independently based on your needs.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Documentation Access Protocol](#documentation-access-protocol)
3. [Setup Overview](#setup-overview)
4. [Evaluation Workflow](#evaluation-workflow)
5. [Bundled Resources](#bundled-resources)

## Quick Start

**Setup (prerequisite)**: Install MLflow 3.8+, configure environment, integrate tracing

**Evaluation workflow in 4 steps**:

1. **Understand**: Understand purpose and strategy of the agent
2. **Define**: Select/create scorers for quality criteria
3. **Dataset**: ALWAYS discover existing datasets first, only create new if needed
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

## Documentation Access Protocol

**All MLflow documentation must be accessed through llms.txt:**

1. Start at: `https://mlflow.org/docs/latest/llms.txt`
2. Query llms.txt for your topic with specific prompt
3. If llms.txt references another doc, use WebFetch with that URL
4. Do not use WebSearch - use WebFetch with llms.txt first

**This applies to all steps**, especially:

- Dataset creation (read GenAI dataset docs from llms.txt)
- Scorer registration (check MLflow docs for scorer APIs)
- Evaluation execution (understand mlflow.genai.evaluate API)

**Before writing any code**
- Read `.claude/skills/agent-evaluation/patterns/GOTCHAS.md` for common mistakes that cause failures
- Read `.claude/skills/agent-evaluation/patterns/CRITICAL-interfaces.md` for exact API signatures and data schemas

**For further documentation** 
- Quick lookup of available files under `.claude/skills/agent-evaluation/patterns/`:

| Reference | Purpose | When to Read |
|-----------|---------|--------------|
| `GOTCHAS.md` | Common mistakes | **Always read first** before writing code |
| `CRITICAL-interfaces.md` | API signatures, schemas |  **Always read first** When writing any evaluation code |
| `patterns-evaluation.md` | Running evals, comparing | When executing evaluations |
| `patterns-scorers.md` | Custom scorer creation | When built-in scorers aren't enough |
| `patterns-datasets.md` | Dataset building | When preparing evaluation data |

## Pre-Flight Validation 

Validate environment before starting:

```bash
uv run mlflow --version  # Should be >=3.8.0
uv run python -c "import mlflow; print(f'MLflow {mlflow.__version__} installed')"
```

If MLflow is missing or version is <3.8.0, see Setup Overview below.

## Setup Overview

Before evaluation, complete these three setup steps:

1. **Install MLflow** (version >=3.8.0)
2. **Configure environment** (tracking URI and experiment)
3. **Integrate tracing** (autolog and @mlflow.trace decorators)

⚠️ **Tracing must work before evaluation.** If tracing fails, stop and troubleshoot.
  - ⚠️ **MANDATORY**: Read `references/tracing-integration.md` documentation BEFORE implementing
  - ✓ **VERIFY**: Run validation script AFTER implementing

**Checkpoint - verify before proceeding:**

- [ ] MLflow >=3.8.0 installed
- [ ] MLFLOW_TRACKING_URI and MLFLOW_EXPERIMENT_ID set
- [ ] Autolog enabled and @mlflow.trace decorators added
- [ ] Test run creates a trace (verify trace ID is not None)

**For complete setup instructions:** See `references/setup-guide.md`

## Evaluation Workflow

### Step 1: Understand Agent Purpose

1. See `references/agent-strategy.md` to start
2. Inspect MLflow trace (especially LLM prompts describing agent purpose)
3. Print your understanding and ask user for verification
4. **Wait for confirmation before proceeding**

### Step 2: Define Quality Scorers

1. Check existing scorers: `uv run mlflow scorers list --experiment-id $MLFLOW_EXPERIMENT_ID`
2. Discover built-in scorers: `uv run mlflow scorers list -b`
3. Identify gaps and register additional scorers if needed
4. Test scorers on sample trace before full evaluation

**For scorer selection and registration:** See `references/scorers.md`
**For CLI constraints (yes/no format, template variables):** See `references/scorers-constraints.md`

## Step 3: Evaluation Dataset and Ground Truth

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
### If User Says NO (No Ground Truth Dataset Skip Step 4):

Warn the user:

"**Important Note:** While you can evaluate without ground truth, having a ground truth dataset significantly improves evaluation quality. You'll be limited to scorers that assess general quality rather than correctness against expected answers. Consider creating even a small ground truth dataset (10-15 examples) for your most critical use cases.

Proceeding with scorers that don't require ground truth..."

## Step 4: Prepare Evaluation Dataset

**ALWAYS discover existing datasets first** to prevent duplicate work:

1. **Run dataset discovery** (mandatory):

   ```bash
   uv run python scripts/list_datasets.py
   ```

2. **Present findings to user**:

   - Show all discovered datasets with their characteristics (size, topics covered)
   - If datasets found, highlight most relevant options based on agent type

3. **Ask user about existing datasets**:

   - "I found [N] existing evaluation dataset(s). Do you want to use one of these? (y/n)"
   - If yes: Ask which dataset to use and record the dataset name
   - If no: Proceed to step 5

4. **Create new dataset only if user declined existing ones**:
   ```bash
   uv run python scripts/create_dataset_template.py
   ```
   Review and execute the generated script.

**IMPORTANT**: Do not skip dataset discovery. Always run `list_datasets.py` first, even if you plan to create a new dataset. This prevents duplicate work and ensures users are aware of existing evaluation datasets.

**For complete dataset guide:** See `references/dataset-preparation.md`

### Step 5: Create and Run Evaluation

1. Generate traces:

  Write script to `agent_server/evaluate_agent.py` file
   
   ```bash
   uv run python scripts/run_evaluation_template.py
   ```
   Review and execute the generated script.

2. Apply scorers:

   ```bash
   uv run mlflow traces evaluate \
     --trace-ids <comma_separated_trace_ids> \
     --scorers <scorer1>,<scorer2>,... \
     --output json > evaluation_results.json
   ```

3. Analyze results:

  Write the generated report `evaluation_report.md` to `agent_server/evaluation/docs/`
   
   ```bash
   uv run python scripts/analyze_results.py evaluation_results.json
   ```
   Generates `evaluation_report.md` with pass rates, failure patterns, and recommendations.

## Bundled Resources

This skill includes scripts and reference documentation to support the evaluation workflow.

### Scripts (scripts/)

Executable automation for common operations:

**Validation Scripts:**

- **validate_environment.py**: Environment validation (mlflow doctor + custom checks)

  - **Use**: Pre-flight check before starting
  - Checks MLflow version, env vars, connectivity

- **validate_auth.py**: Authentication testing

  - **Use**: Before expensive operations
  - Tests Databricks/local auth, LLM provider

- **validate_tracing_static.py**: Static tracing validation (NO auth needed)

  - **Use**: Step 4.4 Stage 1
  - Code analysis only - fast validation

- **validate_tracing_runtime.py**: Runtime tracing validation (REQUIRES auth, BLOCKING)
  - **Use**: Step 4.4 Stage 2
  - Runs agent to verify traces are captured

**Setup & Configuration:**

- **setup_mlflow.py**: Interactive environment configuration
  - **Use**: Step 2 (Configure Environment)
  - Handles tracking URI and experiment ID setup

**Dataset Management:**

- **list_datasets.py**: Dataset discovery and comparison

  - **Use**: Step 4 - MANDATORY first step
  - Lists, compares, recommends datasets with diversity metrics
  - Always run before considering dataset creation

- **create_dataset_template.py**: Dataset creation code generator
  - **Use**: Step 4 - ONLY if user declines existing datasets
  - Generates customized dataset creation script
  - **IMPORTANT**: Generated code uses `mlflow.genai.datasets` APIs and prompts you to inspect agent function signature to match parameters exactly

**Evaluation:**

- **run_evaluation_template.py**: Evaluation execution code generator

  - **Use**: Step 5.1 (Generate Traces)
  - Generates evaluation script using `mlflow.genai.evaluate()`
  - **IMPORTANT**: Loads dataset using `mlflow.genai.datasets.search_datasets()` - never manually recreates data

- **analyze_results.py**: Results analysis and insights
  - **Use**: Step 5.3 (After applying scorers)
  - Pattern detection, recommendations, report generation

### References (references/)

Detailed guides loaded as needed:

- **setup-guide.md** (~180 lines)

  - **When to read**: During Setup (before evaluation)
  - **Covers**: MLflow installation, environment configuration, tracing integration
  - Complete setup instructions with checkpoints

- **agent-strategy.md** (~125 lines)
  - **When to read**: When extracting agent information and understanding
  - **Covers**: agent architecture, user intent, purpose, relevant score finding
  - Interactive guide with instructions and questions

- **tracing-integration.md** (~450 lines)

  - **When to read**: During Step 3 of Setup (Integrate Tracing)
  - **Covers**: Autolog, decorators, session tracking, verification
  - Complete implementation guide with code examples

- **dataset-preparation.md** (~320 lines)

  - **When to read**: During Evaluation Step 3 (Prepare Dataset)
  - **Covers**: Dataset schema, APIs, creation, Unity Catalog
  - Full workflow with Databricks considerations

- **scorers.md** (~430 lines)

  - **When to read**: During Evaluation Step 2 (Define Scorers)
  - **Covers**: Built-in vs custom, registration, testing, design patterns
  - Comprehensive scorer guide

- **scorers-constraints.md** (~150 lines)

  - **When to read**: When registering custom scorers with CLI
  - **Covers**: Template variable constraints, yes/no format, common mistakes
  - Critical CLI requirements and examples

- **troubleshooting.md** (~460 lines)
  - **When to read**: When encountering errors at any step
  - **Covers**: Environment, tracing, dataset, evaluation, scorer issues
  - Organized by phase with error/cause/solution format

### Patterns

  - **CRITICAL-interfaces.md**

  - **When to read**:
  - **Covers**: 
  - 

- **GOTCHAS.md** 

  - **When to read**:
  - **Covers**: 
  - 

- **patterns-datasets.md** 

  - **When to read**: 
  - **Covers**: 
  - 

- **patterns-evaluation.md** 

  - **When to read**: 
  - **Covers**: 
  - 

- **patterns-scorers.md** 
  - **When to read**: 
  - **Covers**: 
  - 


### Assets (assets/)

Output templates (not loaded to context):

- **evaluation_report_template.md**
  - **Use**: Step 5.3 (Analyze Results)
  - Structured template for evaluation report generation