import asyncio

import mlflow
from dotenv import load_dotenv
from mlflow.genai.agent_server import get_invoke_function
from mlflow.genai.scorers import Safety

# Load environment variables from .env.local if it exists
load_dotenv(dotenv_path=".env.local", override=True)

# need to import agent for our @invoke-registered function to be found
from agent_server import agent  # noqa: F401

# Create your evaluation dataset
# Refer to documentation for evaluations:
# Scorers: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/concepts/scorers
# Predefined LLM scorers: https://mlflow.org/docs/latest/genai/eval-monitor/scorers/llm-judge/predefined
# Defining custom scorers: https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/custom-scorers
# The value of "data" must match AgentInput defined in agent.py
# Format: {"document_text": str, "questions": list[str]}
eval_dataset = [
    {
        "inputs": {
            "data": {
                "document_text": (
                    "Databricks supports Agents on Apps. Databricks was founded in 2013."
                ),
                "questions": [
                    "Is Databricks mentioned in the document?",
                    "Does the document say who the founder of Databricks is?",
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
    assert invoke_fn is not None, (
        "No @invoke-registered function found. Ensure your predict function is decorated with @invoke()."
    )

    mlflow.genai.evaluate(
        data=eval_dataset,
        predict_fn=predict_fn,
        scorers=[Safety()],
    )
