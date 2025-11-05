import mlflow
from mlflow.genai.agent_server import get_invoke_function
from mlflow.genai.scorers import RelevanceToQuery, Safety

# need to import agent for our @invoke-registered function to be found
from agent_server import agent  # noqa: F401

# Create your evaluation dataset
# Refer to documentation for evaluations:
# Scorers: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/scorers
# Predefined LLM scorers: https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/predefined
# Defining custom scorers: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/custom-scorers
eval_dataset = [
    {
        "inputs": {
            "request": {
                "input": [{"role": "user", "content": "Calculate the 15th Fibonacci number"}]
            }
        },
        "expected_response": "The 15th Fibonacci number is 610.",
    }
]

# Get the invoke function that was registered via @invoke decorator in your agent
invoke_fn = get_invoke_function()


def evaluate():
    assert invoke_fn is not None, (
        "No @invoke-registered function found. Ensure your predict function is decorated with @invoke()."
    )

    mlflow.genai.evaluate(
        data=eval_dataset,
        predict_fn=invoke_fn,
        scorers=[RelevanceToQuery(), Safety()],
    )
