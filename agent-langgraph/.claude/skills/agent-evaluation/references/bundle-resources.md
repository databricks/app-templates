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
  - Auto-detects module and entry point (override with --module, --entry-point)

**Setup & Configuration:**

- **setup_mlflow.py**: Environment configuration with auto-detection
  - **Use**: Step 2 (Configure Environment)
  - Auto-detects tracking URI and experiment ID with optional overrides

**Dataset Management:**

- **list_datasets.py**: Dataset discovery and comparison

  - **Use**: Step 4 - MANDATORY first step
  - Lists, compares, recommends datasets with diversity metrics
  - Always run before considering dataset creation

- **create_dataset_template.py**: Dataset creation code generator
  - **Use**: Step 4 - ONLY if user declines existing datasets
  - Generates customized dataset creation script
  - **REQUIRED**: --test-cases-file argument with test queries
  - **IMPORTANT**: Generated code uses `mlflow.genai.datasets` APIs and prompts you to inspect agent function signature to match parameters exactly

**Evaluation:**

- **run_evaluation_template.py**: Evaluation execution code generator

  - **Use**: Step 5.1 (Generate Traces)
  - Generates evaluation script using `mlflow.genai.evaluate()`
  - Auto-detects agent module, entry point, and dataset
  - **IMPORTANT**: Loads dataset using `mlflow.genai.datasets.search_datasets()` - never manually recreates data

- **analyze_results.py**: Results analysis and insights
  - **Use**: Step 5.3 (After applying scorers)
  - Pattern detection, recommendations, report generation

### Script CLI Arguments Reference

All scripts support non-interactive execution with CLI arguments:

**Setup:**

- `setup_mlflow.py [--tracking-uri URI] [--experiment-name NAME] [--experiment-id ID] [--create]`

**Validation:**

- `validate_environment.py` (no args)
- `validate_auth.py` (no args)
- `validate_tracing_static.py` (no args)
- `validate_tracing_runtime.py [--module NAME] [--entry-point FUNC]`

**Datasets:**

- `list_datasets.py [--format {table,json,names-only}]`
- `create_dataset_template.py --test-cases-file FILE [--dataset-name NAME] [--catalog C --schema S --table T]`

**Evaluation:**

- `run_evaluation_template.py [--module NAME] [--entry-point FUNC] [--dataset-name NAME]`
- `analyze_results.py RESULTS_FILE`

**Auto-detection**: Scripts with optional arguments will auto-detect values when not specified. Provide explicit values only when auto-detection fails or you need to override.

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

### Patterns (patterns/)

  - **CRITICAL-interfaces.md** (~472 lines)

  - **When to read**: Always read first before writing evaluation code
  - **Covers**: API signatures, schemas
  - Learn API patterns, understand scorer interface

- **GOTCHAS.md** (~547 lines)

  - **When to read**: Always read first before writing evaluation code
  - **Covers**: Common mistakes
  - Exact API signatures and data schemas to avoid mistakes with wrong and correct formats

- **patterns-datasets.md** (~870 lines)

  - **When to read**: When preparing evaluation data
  - **Covers**: Dataset building, dataset schemas, trace analysis
  - Supports dataset construction by providing a number of possible patterns

- **patterns-evaluation.md** (~582 lines)

  - **When to read**: When executing evaluations
  - **Covers**: Running evals, comparing, test with evaluation
  - Working patterns for running evaluations, comparing results, and iterating on quality.

- **patterns-scorers.md** (~804 lines)
  - **When to read**: When built-in scorers aren't enough
  - **Covers**: Custom scorer creation
  - Working code patterns for creating and using scorers.

### Assets (assets/)

Output templates (not loaded to context):

- **evaluation_report_template.md**
  - **Use**: Step 5.3 (Analyze Results)
  - Structured template for evaluation report generation