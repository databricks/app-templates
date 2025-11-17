import mlflow
from mlflow.genai.scorers import Safety
from agent_server import agent # need to import agent for our @invoke-registered function to be found
from agent_server.server import get_invoke_function
import asyncio

# Create your evaluation dataset
# Refer to documentation for evaluations:
# Scorers: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/scorers
# Predefined LLM scorers: https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/predefined
# Defining custom scorers: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/custom-scorers
# The value of "data" must match input defined by your agent
eval_dataset = [
    {
        "inputs": {
            "data": {
                "document_text": (
                    "Databricks supports Agents on Apps. "
                    "Databricks was founded in 2013."
                ),
                "questions": [
                    {"text": "Is Databricks mentioned in the document?"},
                    {"text": "Does the document say who the founder of Databricks is?"},
                ],
            }
        },
    },
]

# Get the invoke function that was registered via @invoke decorator in your agent
invoke_fn = get_invoke_function()

def predict_fn(data: dict) -> dict:
    return asyncio.run(invoke_fn(data))


def evaluate():
    assert (
        invoke_fn is not None
    ), "No @invoke-registered function found. Ensure your predict function is decorated with @invoke()."

    mlflow.genai.evaluate(
        data=eval_dataset,
        predict_fn=predict_fn,
        scorers=[Safety()],
    )