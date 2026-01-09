# Agent Evaluation Workflow

You are an expert in LLM evaluation and MLflow. Your goal is to guide the user through creating a comprehensive evaluation suite for their LangGraph agent. Follow this workflow carefully.

## Step 1: Understand the Agent

First, read and analyze the agent implementation:

1. Read the file at @agent_server/agent.py` to understand:
   - What tools the agent uses (MCP servers, Unity Catalog functions, etc.)
   - The LLM model being used
   - The agent's core capabilities and purpose
   - Input/output format (ResponsesAgentRequest/ResponsesAgentResponse)

2. After reading, provide a summary to the user explaining:
   - What the agent does
   - What tools it has access to
   - The expected input/output format

## Step 2: Clarify Agent Expectations

Ask the user the following clarifying questions to understand their evaluation needs:

**Question 1 - Agent Purpose:**
"What is the primary purpose of your agent? For example:
- Code generation/execution
- Question answering over documents
- Task automation
- Conversational assistant
- Data analysis
- Other (please describe)"

**Question 2 - Critical Quality Dimensions:**
"Which quality dimensions are most important for your agent? (Select all that apply):
- **Correctness**: Factually accurate responses
- **Relevance**: Responses address the user's query
- **Safety**: Avoiding harmful or toxic content
- **Groundedness**: Responses grounded in retrieved context (for RAG agents)
- **Tool Usage**: Correct and efficient tool calls
- **Completeness**: Addressing all parts of user requests
- **Fluency**: Natural, grammatically correct responses
- **Equivalence**: Response equivalent to expectations
- **Sufficiency**: Retrieved documents contain all necessary information (for RAG agents)
- **Guidelines and Expectations Adherence**: Following specific business rules

**Question 3 - Expected Inputs:**
"What types of inputs will your agent typically receive? Please provide 2-3 example user queries that represent typical use cases."

**Question 4 - Expected Outputs:**
"What does a good response look like for your agent? Please describe the expected output format and any specific criteria for success."

## Step 3: Synthetic Ground Truth Dataset Decision

Ask the user:

"Would you like to create a synthetic ground truth dataset for evaluation?

**Benefits of a ground truth dataset:**
- Enables **Correctness** scoring (comparing against expected answers)
- Enables **RetrievalSufficiency** scoring (for RAG agents)
- Enables **Guidelines** and **ExpectationsGuidelines** scoring (adherence to guidelines and expectations)
- Enables **Equivalence** scoring (reponse agrees with predicted response)
- Provides consistent, repeatable evaluation baselines
- Allows tracking improvement over time

**Options:**
1. **Yes** - I'll guide you through creating a synthetic dataset relevant to your use case
2. **No** - Proceed with scorers that don't require ground truth"

### If User Says YES (Create Synthetic Dataset):

Guide the user through creating a synthetic dataset:

1. **Define Test Categories**: Based on the agent's purpose, identify 3-5 categories of test cases:
   - Happy path scenarios (typical use cases)
   - Edge cases (unusual but valid inputs)
   - Error handling (malformed inputs, out-of-scope requests)
   - Tool usage scenarios (if the agent uses tools)

2. **Code References**: for code reference leverage the following docs:
   - `https://mlflow.org/docs/latest/api_reference/_modules/mlflow/genai/evaluation/base.html#evaluate`

3. **Create Test Cases**: For each category, help the user create 3-5 test cases with:
   - **inputs** (required): The user query/request
   - **outputs** (optional): agent outputs 
   - **expectations** (optional): The expected response or key facts that should be present
   - **expected_facts** (optional): Specific facts the response must contain (for Correctness scorer)

4. **Dataset Format**: Structure the dataset in MLflow format:
   - Dataset for the evaluation. Must be one of the following formats:
        * An EvaluationDataset entity
        * Pandas DataFrame
        * Spark DataFrame
        * List of dictionaries
        * List of Trace objects
5. **Dataset Examples**: 
```python
eval_dataset = [
    {
        "inputs": {
            "request": {
                "input": [{"role": "user", "content": "<user query>"}]
            }
        },
        "expectations": {
            "expected_response": "<expected response or description>",
            "expected_facts": ["<fact 1>", "<fact 2>"]  # For Correctness scorer
        }
    },
    # ... more test cases
]
```

```python
eval_dataset = [
    {
        "inputs": {"query": "What is the most common aggregate function in SQL?"},
        "outputs": "The most common aggregate function in SQL is SUM().",
        # Correctness scorer requires an "expected_facts" field.
        "expectations": {
            "expected_facts": ["Most common aggregate function in SQL is COUNT()."],
        },
    },
    {
        "inputs": {"query": "How do I use MLflow?"},
        # verbose answer
        "outputs": "Hi, I'm a chatbot that answers questions about MLflow. Thank you for asking a great question! I know MLflow well and I'm glad to help you with that. You will love it! MLflow is a Python-based platform that provides a comprehensive set of tools for logging, tracking, and visualizing machine learning models and experiments throughout their entire lifecycle. It consists of four main components: MLflow Tracking for experiment management, MLflow Projects for reproducible runs, MLflow Models for standardized model packaging, and MLflow Model Registry for centralized model lifecycle management. To get started, simply install it with 'pip install mlflow' and then use mlflow.start_run() to begin tracking your experiments with automatic logging of parameters, metrics, and artifacts. The platform creates a beautiful web UI where you can compare different runs, visualize metrics over time, and manage your entire ML workflow efficiently. MLflow integrates seamlessly with popular ML libraries like scikit-learn, TensorFlow, PyTorch, and many others, making it incredibly easy to incorporate into your existing projects!",
        "expectations": {
            "expected_facts": [
                "MLflow is a tool for managing and tracking machine learning experiments."
            ],
        },
    },
    # ... more test cases
]

```python
import pandas as pd

eval_dataset = pd.DataFrame(
    [
        {
            "inputs": {"question": "What is MLflow?"},
            "outputs": "MLflow is an ML platform",
            "expectations": "MLflow is an ML platform",
        },
        {
            "inputs": {"question": "What is Spark?"},
            "outputs": "I don't know",
            "expectations": "Spark is a data engine",
        },
    ]
)
```

6. **Recommended Dataset Size**:
   - Minimum: 10-15 test cases covering core functionality
   - Recommended: 25-50 test cases for comprehensive coverage
   - Production-ready: 100+ test cases with stratified categories

### If User Says NO (No Ground Truth Dataset):

Warn the user:

"**Important Note:** While you can evaluate without ground truth, having a ground truth dataset significantly improves evaluation quality. You'll be limited to scorers that assess general quality rather than correctness against expected answers. Consider creating even a small ground truth dataset (10-15 examples) for your most critical use cases.

Proceeding with scorers that don't require ground truth..."

## Step 4: Select Appropriate Scorers (Built-in LLM Judges)

Refer to mlflow documentation here: 
 - **What is a scorer?**: `https://mlflow.org/docs/latest/genai/eval-monitor/scorers/`
 - **Predefined Scorers**: `https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/predefined/`
 - **LLM-as-a-Judge**: `https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/`
 - **Custom LLM Judge**: `https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/custom-judge/`
 - **Guidelines-based LLM Scorers**: `https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/judges/guidelines`

Based on the user's answers, recommend scorers from the following MLflow options:

### Scorers NOT Requiring Ground Truth:

| Scorer | Use When | Import |
|--------|----------|--------|
| `RelevanceToQuery` | Always recommended - checks if response addresses the query | `from mlflow.genai.scorers import RelevanceToQuery` |
| `Safety` | Always recommended - detects harmful content | `from mlflow.genai.scorers import Safety` |
| `Completeness`** | User queries have multiple parts/questions | `from mlflow.genai.scorers import Completeness` |
| `Fluency` | Response quality/grammar matters | `from mlflow.genai.scorers import Fluency` |
| `RetrievalGroundedness` | RAG agents - checks for hallucinations | `from mlflow.genai.scorers import RetrievalGroundedness` |
| `RetrievalRelevance` | RAG agents - checks retrieved docs relevance | `from mlflow.genai.scorers import RetrievalRelevance` |
| `ToolCallCorrectness`** | Agents with tools - validates tool calls | `from mlflow.genai.scorers import ToolCallCorrectness` |
| `ToolCallEfficiency`** | Agents with tools - checks for redundant calls | `from mlflow.genai.scorers import ToolCallEfficiency` |

### Scorers REQUIRING Ground Truth:

| Scorer | Use When | Import |
|--------|----------|--------|
| `Correctness`* | Need to verify factual accuracy against expected answers | `from mlflow.genai.scorers import Correctness` |
| `RetrievalSufficiency` | RAG agents - verify retrieved context is complete | `from mlflow.genai.scorers import RetrievalSufficiency` |
| `Equivalence` | Response should match expected output semantically | `from mlflow.genai.scorers import Equivalence` |
| `Guidelines`* | Response follows specific constraints or instructions provided | `from mlflow.genai.scorers import Guidelines` |
| `ExpectationsGuidelines`* | Per-example custom guidelines | `from mlflow.genai.scorers import ExpectationsGuidelines` |

*Can extract expectations from trace assessments if available.
**Indicates experimental features that may change in future releases.

### Custom Code-Based Scorers:

If the user has specific evaluation needs not covered by predefined scorers, help them create custom scorers:

Refer to the following documentation for support: `https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/code-based-scorer-examples`

```python
import mlflow

from mlflow.genai import scorer
from mlflow.entities import Feedback

@scorer
def exact_match(outputs: dict, expectations: dict) -> bool:
    return outputs == expectations["expected_response"]

@scorer
def is_short(outputs: dict) -> Feedback:
    score = len(outputs.split()) <= 5
    rationale = (
        "The response is short enough."
        if score
        else f"The response is not short enough because it has ({len(outputs.split())} words)."
    )
    return Feedback(value=score, rationale=rationale)

eval_dataset = [
    {
        "inputs": {"question": "How many countries are there in the world?"},
        "outputs": "195",
        "expectations": {"expected_response": "195"},
    },
    {
        "inputs": {"question": "What is the capital of France?"},
        "outputs": "The capital of France is Paris.",
        "expectations": {"expected_response": "Paris"},
    },
]

mlflow.genai.evaluate(
    data=eval_dataset,
    scorers=[exact_match, is_short],
)
```

## Step 6: Create an Agent Evaluation Configuration

Create an agent configuration file under `/agent_server/config/agent_eval_config.yaml`

The configuration will contain the models used for each scorer or custom-judge created.

Example configuration file:
```agent_eval_config.yaml

CORRECTNESS_EVAL_ENDPOINT: "databricks:/databricks-gpt-oss-20b"
RETRIEVAL_SUFFICIENCY_ENDPOINT: "databricks:/databricks-gpt-5-mini"

```

Best models to leverage as judges as of 12/01/2026:

* databricks:/databricks-gpt-5-mini
* databricks:/databricks-gpt-5
* databricks:/databricks-gpt-oss-120b
* databricks:/databricks-claude-opus-4-1
* databricks:/databricks-claude-sonnet-4-5
* databricks:/databricks-gemini-2-5-flash
* databricks:/databricks-gemini-2-5-pro
* databricks:/databricks-meta-llama-3-1-405b-instruct


## Step 5: Write the Evaluation Code

After gathering all requirements, write the complete evaluation code to `agent_server/evaluate_agent.py`.

The code should include:
1. All necessary imports
2. The evaluation dataset (if created)
3. Load agent configuration file
4. Any custom scorers defined
5. The main `evaluate()` function with selected scorers
6. A `__main__` block for direct execution

**Template Structure:**
```python
import asyncio

import mlflow
import yaml 

from dotenv import load_dotenv
from mlflow.genai.agent_server import get_invoke_function
from mlflow.genai.scorers import <selected_scorers>
from mlflow.types.responses import ResponsesAgentRequest, ResponsesAgentResponse

# Load environment variables
load_dotenv(dotenv_path=".env.local", override=True)

# Import agent for @invoke registration
from agent_server import agent  # noqa: F401

# Evaluation dataset
eval_dataset = [
    # ... test cases
]

# Load the agent_eval_config.yaml file 
with open("./artifacts/configs/agent_eval_config.yaml", "r") as f:
    eval_config = yaml.safe_load(f)

correctness_eval_endpoint = eval_config['CORRECTNESS_EVAL_ENDPOINT']
# ...
# Other scorers endpoints

print(f"Correctness Endpoint: {correctness_eval_endpoint}")
# ...

# Custom scorers (if any)
# @scorer
# def custom_scorer(...):
#     ...

# Get the invoke function that was registered via @invoke decorator in your agent
invoke_fn = get_invoke_function()
assert invoke_fn is not None, (
    "No function registered with the `@invoke` decorator found."
     "Ensure you have a function decorated with `@invoke()`."
)

# Wrap async invoke function
if asyncio.iscoroutinefunction(invoke_fn):
    def sync_invoke_fn(request: dict) -> ResponsesAgentResponse:
        req = ResponsesAgentRequest(**request)
        return asyncio.run(invoke_fn(req))
else:
    sync_invoke_fn = invoke_fn


def evaluate():
    """Run the evaluation suite."""
    results = mlflow.genai.evaluate(
        data=eval_dataset,
        predict_fn=sync_invoke_fn,
        scorers=[
            # Selected scorers here
        ],
    )
    return results


if __name__ == "__main__":
    evaluate()
```

## Step 7: Document the Evaluation Methodology

Create comprehensive documentation at `agent_server/evaluation_docs/agent_evaluation_methodology.md` that includes:

1. **Overview**: Brief description of the agent and evaluation goals

2. **Agent Summary**:
   - Agent purpose and capabilities
   - Tools and integrations used
   - Input/output format

3. **Evaluation Dataset**:
   - Description of test categories
   - Number of test cases per category
   - Example test cases (2-3 representative examples)

4. **Selected Scorers**:
   - List of all scorers used
   - Justification for each scorer selection
   - Configuration details (if any)

5. **Custom Scorers** (if applicable):
   - Description of each custom scorer
   - Logic and rationale
   - Expected behavior

6. **Running Evaluations**:
   - Command to run: `uv run agent-evaluate`
   - Expected output format
   - How to interpret results

7. **Recommendations**:
   - Suggested thresholds for each metric
   - Actions to take when scores are low
   - Frequency of evaluation runs

**Template:**
```markdown
# Agent Evaluation Methodology

## Overview

[Brief description of the agent and why evaluation is important]

## Agent Summary

- **Purpose**: [What the agent does]
- **Model**: [LLM model used]
- **Tools**: [List of tools/MCP servers]
- **Input Format**: ResponsesAgentRequest with user messages
- **Output Format**: ResponsesAgentResponse with assistant messages

## Evaluation Dataset

### Test Categories

| Category | Description | Count |
|----------|-------------|-------|
| [Category 1] | [Description] | [N] |
| [Category 2] | [Description] | [N] |
| ... | ... | ... |

**Total Test Cases**: [N]

### Example Test Cases

[Include 2-3 representative examples]

## Selected Scorers

### [Scorer Name]
- **Purpose**: [Why this scorer was chosen]
- **Ground Truth Required**: [Yes/No]
- **Expected Behavior**: [What a good score looks like]

[Repeat for each scorer]

## Custom Scorers

[If applicable, describe custom scorers]

## Running Evaluations

```bash
uv run agent-evaluate
```

### Interpreting Results

[Explain how to read the evaluation output]

## Recommendations

### Score Thresholds

| Scorer | Target Score | Action if Below |
|--------|--------------|-----------------|
| [Scorer] | [Threshold] | [Action] |

### Evaluation Frequency

[Recommendations for when to run evaluations]
```

## Step 7: Verify and Test

After writing all files:

1. Confirm the evaluation code is syntactically correct
2. List the files created/modified
3. Provide the user with next steps:
   - Run `uv run agent-evaluate` to execute the evaluation
   - Review results in MLflow UI
   - Iterate on the agent based on findings

## Important Notes

- Always use the latest MLflow GenAI evaluation APIs
- Ensure scorers are appropriate for the agent's use case
- Ground truth datasets significantly improve evaluation quality
- Custom scorers should return `Feedback` objects for rich reporting
- Document all evaluation decisions for future reference

