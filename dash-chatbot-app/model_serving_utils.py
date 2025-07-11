from mlflow.deployments import get_deploy_client

def _query_endpoint(endpoint_name: str, messages: list[dict[str, str]], max_tokens) -> list[dict[str, str]]:
    """Calls a model serving endpoint."""
    res = get_deploy_client('databricks').predict(
        endpoint=endpoint_name,
        inputs={'messages': messages, "max_tokens": max_tokens},
    )
    if "messages" in res:
        return res["messages"]
    elif "choices" in res:
        return [res["choices"][0]["message"]]
    raise Exception("This app can only run against:"
                    "1) Databricks foundation model or external model endpoints with the chat task type (described in https://docs.databricks.com/aws/en/machine-learning/model-serving/score-foundation-models#chat-completion-model-query)"
                    "2) Databricks agent serving endpoints that implement the conversational agent schema documented "
                    "in https://docs.databricks.com/aws/en/generative-ai/agent-framework/author-agent")

def query_endpoint(endpoint_name, messages, max_tokens):
    return _query_endpoint(endpoint_name, messages, max_tokens)[-1]
