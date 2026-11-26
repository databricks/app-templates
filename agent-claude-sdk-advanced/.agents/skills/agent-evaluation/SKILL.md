---
name: agent-evaluation
description: Use this when you need to EVALUATE OR IMPROVE or OPTIMIZE an existing LLM agent's output quality - including improving tool selection accuracy, answer quality, reducing costs, or fixing issues where the agent gives wrong/incomplete responses. Evaluates agents systematically using MLflow evaluation with datasets, scorers, and tracing. IMPORTANT - Always also load the instrumenting-with-mlflow-tracing skill before starting any work. Covers end-to-end evaluation workflow or individual components (tracing setup, dataset creation, scorer definition, evaluation execution).
allowed-tools: Read, Write, Bash, Grep, Glob, WebFetch
---

# Agent Evaluation with MLflow

Comprehensive guide for evaluating GenAI agents with MLflow. Use this skill for the complete evaluation workflow or individual components - tracing setup, environment configuration, dataset creation, scorer definition, or evaluation execution. Each section can be used independently based on your needs.

## ⛔ CRITICAL: Must Use MLflow APIs

**DO NOT create custom evaluation frameworks.** You MUST use MLflow's native APIs:

- **Datasets**: Use `mlflow.genai.datasets.create_dataset()` - NOT custom test case files
- **Scorers**: Use `mlflow.genai.scorers` and `mlflow.genai.judges.make_judge()` - NOT custom scorer functions
- **Evaluation**: Use `mlflow.genai.evaluate()` - NOT custom evaluation loops
- **Scripts**: Use the provided `scripts/` directory templates - NOT custom `evaluation/` directories

**Why?** MLflow tracks everything (datasets, scorers, traces, results) in the experiment. Custom frameworks bypass this and lose all observability.

If you're tempted to create `evaluation/eval_dataset.py` or similar custom files, STOP. Use `scripts/create_dataset_template.py` instead.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Documentation Access Protocol](#documentation-access-protocol)
3. [Setup Overview](#setup-overview)
4. [Evaluation Workflow](#evaluation-workflow)
5. [References](#references)

## Quick Start

**⚠️ REMINDER: Use MLflow APIs from this skill. Do not create custom evaluation frameworks.**

**Setup (prerequisite)**: Install MLflow 3.8+, configure environment, integrate tracing

**Evaluation workflow in 5 steps** (each uses MLflow APIs):

1. **Understand**: Run agent, inspect traces, understand purpose
2. **Scorers**: Select and register scorers for quality criteria
3. **Dataset**: ALWAYS discover existing datasets first, only create new if needed
3.5. **Dry Run**: Run 3 questions first — catch broken tools and misconfigured scorers before full eval
4. **Evaluate**: Run agent on dataset, apply scorers, analyze results

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
# Save both separately for debugging
uv run mlflow traces evaluate ... --output json > results.json 2> evaluation.log
```

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

## Discovering Agent Structure

**Each project has unique structure.** Use dynamic exploration instead of assumptions:

### Find Agent Entry Points
```bash
# Search for main agent functions
grep -r "def.*agent" . --include="*.py"
grep -r "def (run|stream|handle|process)" . --include="*.py"

# Check common locations
ls main.py app.py src/*/agent.py 2>/dev/null

# Look for API routes
grep -r "@app\.(get|post)" . --include="*.py"  # FastAPI/Flask
grep -r "def.*route" . --include="*.py"
```

### Understand Project Structure
```bash
# Check entry points in package config
cat pyproject.toml setup.py 2>/dev/null | grep -A 5 "scripts\|entry_points"

# Read project documentation
cat README.md docs/*.md 2>/dev/null | head -100

# Explore main directories
ls -la src/ app/ agent/ 2>/dev/null
```

## Setup Overview

### Pre-check: Use Existing Environment

**Before doing ANY setup, check if `MLFLOW_TRACKING_URI` and `MLFLOW_EXPERIMENT_ID` are already set:**

```bash
echo "MLFLOW_TRACKING_URI=$MLFLOW_TRACKING_URI"
echo "MLFLOW_EXPERIMENT_ID=$MLFLOW_EXPERIMENT_ID"
```

**If BOTH are already set, skip Steps 1-2 entirely.** The environment is pre-configured. Do NOT run `setup_mlflow.py`, do NOT create a `.env` file, do NOT override these values. Go directly to Step 3 (tracing integration) and the evaluation workflow.

### Setup Steps (only if environment is NOT pre-configured)

1. **Install MLflow** (version >=3.8.0)
2. **Configure environment** (tracking URI and experiment)
   - **Guide**: Follow `references/setup-guide.md` Steps 1-2
3. **Integrate tracing** (autolog and @mlflow.trace decorators)
   - ⚠️ **MANDATORY**: Use the `instrumenting-with-mlflow-tracing` skill for tracing setup
   - ✓ **VERIFY**: Run `scripts/validate_tracing_runtime.py` after implementing

⚠️ **Tracing must work before evaluation.** If tracing fails, stop and troubleshoot.

**Checkpoint - verify before proceeding:**

- [ ] MLflow >=3.8.0 installed
- [ ] MLFLOW_TRACKING_URI and MLFLOW_EXPERIMENT_ID set
- [ ] Autolog enabled and @mlflow.trace decorators added
- [ ] Test run creates a trace (verify trace ID is not None)

**Validation scripts:**
```bash
uv run python scripts/validate_environment.py  # Check MLflow install, env vars, connectivity
uv run python scripts/validate_auth.py         # Test authentication before expensive operations
```

## Evaluation Workflow

### Step 1: Agent Interview (REQUIRED — do not skip)

Before doing anything else, ask the user these questions. Do NOT proceed until you have answers.

**Required:**
1. "What does your agent do? Describe its purpose in 1-2 sentences."
2. "What are the 2-3 most important things it needs to get right?"
3. "Are there common failure modes you've already noticed?"

**Use answers to:**
- Derive scorer names and criteria (do not invent them)
- Write the `agent_description` parameter for `generate_evals_df`
- Set evaluation priorities

**If running in automated mode:** Read agent purpose from the codebase (SKILL.md, README, or main entry point docstring). Still surface what you found and confirm before proceeding.

### Step 2: Define Quality Scorers

1. **Check registered scorers in your experiment:**
   ```bash
   uv run mlflow scorers list -x $MLFLOW_EXPERIMENT_ID
   ```

**IMPORTANT: if there are registered scorers in the experiment then they must be used for evaluation.**

2. **Select additional built-in scorers that apply to the agent** 

See `references/scorers.md` for the built-in scorers. Select any that are useful for assessing the agent's quality and that are not already registered. 

3. **Create additional custom scorers as needed**

If needed, create additional scorers using the `make_judge()` API. See `references/scorers.md` on how to create custom scorers and `references/scorers-constraints.md` for best practices.

> ⚠️ **CRITICAL — Scorer Return Values:** Scorers MUST instruct the LLM judge to return `"yes"` or `"no"` (or booleans/numerics). Return values of `"pass"` or `"fail"` are **silently cast to `None`** by `_cast_assessment_value_to_float` and **excluded from `results.metrics`** with no error or warning — results simply disappear. See `references/scorers-constraints.md` Constraint 2 for the full list of safe vs. broken return values.

4. **REQUIRED: Register new scorers before evaluation** using Python API:
   
   ```python
   from mlflow.genai.judges import make_judge
   from mlflow.genai.scorers import BuiltinScorerName
   import os

   scorer = make_judge(...)  # Or, scorer = BuiltinScorerName()
   scorer.register()
   ```

** IMPORTANT:  See `references/scorers.md` → "Model Selection for Scorers" to configure the `model` parameter of scorers before registration.

⚠️ **Scorers MUST be registered before evaluation.** Inline scorers that aren't registered won't appear in `mlflow scorers list` and won't be reusable.

5. **Verify registration:**
   ```bash
   uv run mlflow scorers list -x $MLFLOW_EXPERIMENT_ID  # Should show your scorers
   ```

### Step 3: Prepare Evaluation Dataset

**ALWAYS discover existing datasets first** to prevent duplicate work:

1. **Run dataset discovery** (mandatory):

   ```bash
   uv run python scripts/list_datasets.py  # Lists, compares, recommends datasets
   uv run python scripts/list_datasets.py --format json  # Machine-readable output
   uv run python scripts/list_datasets.py --help  # All options
   ```

2. **Present findings to user**:

   - Show all discovered datasets with their characteristics (size, topics covered)
   - If datasets found, highlight most relevant options based on agent type

3. **Ask user about existing datasets**:

   - "I found [N] existing evaluation dataset(s). Do you want to use one of these? (y/n)"
   - If yes: Ask which dataset to use and record the dataset name — skip to Step 3.5
   - If no: Proceed to Phase A below

**If creating a new dataset, use the two-phase approach below.**

---

#### Phase A: Sanity Check (5 questions — always run first)

Create a minimal 5-question dataset manually from the Step 1 interview answers. The goal is to confirm the pipeline works end-to-end before investing in large-scale generation.

```python
import mlflow
from mlflow.genai.datasets import create_dataset

# Derive 5 representative questions directly from the agent's stated purpose
# and known failure modes identified in Step 1
sanity_records = [
    {"inputs": {"query": "<question 1 from interview>"}, "expected_response": "<expected answer>"},
    {"inputs": {"query": "<question 2 from interview>"}, "expected_response": "<expected answer>"},
    # ... 5 total
]

sanity_dataset = create_dataset(
    records=sanity_records,
    name="sanity-check-5q",
)
```

Run evaluation on this dataset (see Step 4), then **present results to the user** with this framing:

> "This is a sanity check — 5 questions confirm the pipeline works but aren't statistically meaningful. Proceeding to Phase B to generate a proper evaluation set."

Only proceed to Phase B once Phase A completes without errors.

---

#### Phase B: Proper Evaluation Dataset (100+ questions — run after Phase A passes)

Generate questions from the agent's actual corpus rather than inventing them from scratch. The approach depends on whether the project uses Databricks or OSS MLflow.

**On Databricks** — use `generate_evals_df` to synthesize questions from the agent's document corpus:

```python
from databricks.agents.evals import generate_evals_df, estimate_synthetic_num_evals
import mlflow

# agent_description comes from Step 1 interview answers
agent_description = "<agent purpose from interview>"

# docs_df: a Spark or pandas DataFrame with a "content" column containing
# the documents/chunks the agent retrieves from (e.g., your Vector Search index)
evals = generate_evals_df(
    docs=docs_df,
    num_evals=100,
    agent_description=agent_description,
)

# Merge into MLflow dataset — don't create a separate dataset
dataset = mlflow.genai.datasets.create_dataset(name="generated-evals-100q")
dataset.merge_records(evals)
```

To estimate the right `num_evals` before generating:

```python
recommended = estimate_synthetic_num_evals(docs_df)
print(f"Recommended num_evals: {recommended}")
```

**Dataset size guidance:**
- **<30 questions**: not statistically meaningful — avoid drawing conclusions
- **50–100 questions**: adequate for catching regressions, suitable for most agents
- **200+ questions**: recommended when comparing model variants or scoring multiple dimensions

**On OSS MLflow** — use RAGAS `TestsetGenerator` to generate from your document corpus:

```python
from ragas.testset import TestsetGenerator
from ragas.llms import LangchainLLMWrapper
from ragas.embeddings import LangchainEmbeddingsWrapper

generator = TestsetGenerator(
    llm=LangchainLLMWrapper(your_llm),
    embedding_model=LangchainEmbeddingsWrapper(your_embeddings),
)
testset = generator.generate_with_langchain_docs(docs, testset_size=100)
evals_df = testset.to_pandas()

# Convert to MLflow dataset schema and merge
import mlflow
records = [
    {"inputs": {"query": row["user_input"]}, "expected_response": row["reference"]}
    for _, row in evals_df.iterrows()
]
dataset = mlflow.genai.datasets.create_dataset(name="generated-evals-100q")
dataset.merge_records(records)
```

**If no document corpus is available** — ask the user to provide 50–100 representative queries from production logs or usage history. These are more realistic than synthetic questions and are preferable when available.

---

**IMPORTANT**: Do not skip dataset discovery. Always run `list_datasets.py` first, even if you plan to create a new dataset. This prevents duplicate work and ensures users are aware of existing evaluation datasets.

**For complete dataset guide:** See `references/dataset-preparation.md`

**Checkpoint - verify before proceeding:**

- [ ] Scorers have been registered
- [ ] Phase A sanity check passed (pipeline runs end-to-end)
- [ ] Phase B dataset created with 50+ questions (or existing dataset selected)

### Step 3.5: Dry Run (REQUIRED before full eval)

Run evaluation on **3 questions** from the dataset before committing to the full run. This catches broken tools, misconfigured scorers, and auth failures early — before they silently corrupt 100-question results.

If you completed Phase A above, the pipeline is already validated — focus the dry run on scorer output only.

```python
import mlflow

dataset = mlflow.genai.datasets.get_dataset(name="<your-dataset-name>")
dry_run_records = dataset.df.head(3)
```

Run `mlflow.genai.evaluate()` on these 3 records using the same wrapper and scorers as the full eval.

**For each response, check:**

1. **Tool calls** — Did the agent call any tools? If it called zero tools on questions that require retrieval, tools are likely broken (403s, rate limits, missing credentials).
2. **Response quality** — Are responses empty or generic ("I don't know", "I can't help with that")? Empty responses score as irrelevant and will skew the full eval.
3. **Scorer output** — Did all 3 scores come back as `0` or `None`? If so, the scorer is misconfigured (check return values — `"pass"`/`"fail"` are silently cast to `None`; use `"yes"`/`"no"` instead).

**Decision gate:**

- **If dry run shows tool failures or empty responses:** Stop. Fix the underlying issue (auth, tool config, retrieval) before proceeding. Do not run the full eval on broken infrastructure.
- **If all 3 scorer outputs are 0 or None:** Stop. Debug scorer return values and re-register before proceeding.
- **If dry run passes:** Report to the user: *"Dry run passed (3/3 responses non-empty, tools called, scores non-zero). Proceeding to full eval."* Then continue to Step 4.

> **Why this matters:** Tool failures (403s from docs scraping, GitHub API rate limits) produce empty agent responses that score as 0. Running a 100-question eval only to discover all tools were failing wastes time and produces misleading results. The dry run catches this in under a minute.

---

### Step 4: Run Evaluation

> **Large datasets (50+ questions)?** See `references/throughput-guide.md` for throughput optimization — covers parallelism env vars, async predict functions, and dataset splitting for 200+ question evals.

#### 4a. Estimate Runtime Before Starting

Before launching evaluation, tell the user how long it will take:

1. **Count the dataset questions:**
   ```python
   import mlflow
   dataset = mlflow.genai.datasets.get_dataset(name="<your-dataset-name>")
   print(f"Dataset size: {len(dataset.df)} questions")
   ```

2. **Calculate the estimate** — each question runs the agent once and the judge scorer once:
   - Opus-class judge models (e.g. `claude-opus-4`): ~45–90s per question
   - Sonnet-class judge models (e.g. `claude-sonnet-4`): ~20–45s per question
   - Multiple scorers per question add time proportionally

   ```
   Estimated time = N questions × 30–60s per question ÷ parallelism factor (typically 4–8x)
   ```

3. **Tell the user before starting:**
   > "This dataset has N questions. At ~30–60s per question with typical parallelism, evaluation will take approximately **X–Y minutes**. I'll run it as a background task so you can continue working — I'll summarize the results when it's done."

#### 4b. Generate the Evaluation Script

```bash
# Generate evaluation script (specify module and entry point)
uv run python scripts/run_evaluation_template.py \
  --module mlflow_agent.agent \
  --entry-point run_agent
```

The generated script creates a wrapper function that:
- Accepts keyword arguments matching the dataset's input keys
- Provides any additional arguments the agent needs (like `llm_provider`)
- Runs `mlflow.genai.evaluate(data=df, predict_fn=wrapper, scorers=registered_scorers)`
- Saves results to `evaluation_results.csv`

⚠️ **CRITICAL: wrapper Signature Must Match Dataset Input Keys**

MLflow calls `predict_fn(**inputs)` - it unpacks the inputs dict as keyword arguments.

| Dataset Record | MLflow Calls | predict_fn Must Be |
|----------------|--------------|-------------------|
| `{"inputs": {"query": "..."}}` | `predict_fn(query="...")` | `def wrapper(query):` |
| `{"inputs": {"question": "...", "context": "..."}}` | `predict_fn(question="...", context="...")` | `def wrapper(question, context):` |

**Common Mistake (WRONG):**
```python
def wrapper(inputs):  # ❌ WRONG - inputs is NOT a dict
    return agent(inputs["query"])
```

#### 4c. Launch as a Background Sub-Agent

Run the evaluation as a background sub-agent so the main session stays available. Use the Agent tool with `run_in_background: true`:

**Sub-agent instructions (pass these verbatim):**
```
Run the agent evaluation and write results to scratchpad.

Steps:
1. cd <project-directory>
2. Run: uv run python run_agent_evaluation.py
3. When complete, write a summary to scratchpad/eval-results.md with:
   - Exit status (success or error message)
   - Path to results file (evaluation_results.csv)
   - Wall-clock time taken
4. Return only: "Evaluation complete. Results written to scratchpad/eval-results.md"
```

**In the main session, poll for completion** by checking for the scratchpad file rather than blocking:

```python
# Poll every 30s using Glob
# Glob("scratchpad/eval-results.md")
# When the file appears, read it and proceed to analysis
```

Do NOT use TaskOutput to wait for the background agent — that dumps the full transcript (~10–20k tokens) into the main context.

#### 4d. Analyze Results (after evaluation completes)

Once `scratchpad/eval-results.md` appears, run analysis:

```bash
# Pattern detection, failure analysis, recommendations
# Reads the CSV produced by mlflow.genai.evaluate() above
uv run python scripts/analyze_results.py evaluation_results.csv
```

Generates `evaluation_report.md` with per-scorer pass rates and improvement suggestions.

The script reads `{scorer_name}/value` and `{scorer_name}/rationale` columns from the CSV.
It also accepts the legacy JSON format from `mlflow traces evaluate` for backward compatibility:
```bash
uv run python scripts/analyze_results.py evaluation_results.json  # legacy format
uv run python scripts/analyze_results.py evaluation_results.csv --output my_report.md  # custom output
```

## References

Detailed guides in `references/` (load as needed):

- **setup-guide.md** - Environment setup (MLflow install, tracking URI configuration)
- **Tracing**: Use the `instrumenting-with-mlflow-tracing` skill (authoritative guide for autolog, decorators, session tracking, verification)
- **dataset-preparation.md** - Dataset schema, APIs, creation, Unity Catalog
- **scorers.md** - Built-in vs custom scorers, registration, testing
- **scorers-constraints.md** - CLI requirements for custom scorers (yes/no format, templates)
- **troubleshooting.md** - Common errors by phase with solutions
- **throughput-guide.md** - Parallelism env vars, async predict_fn, dataset splitting for 200+ question evals

Scripts are self-documenting - run with `--help` for usage details.
