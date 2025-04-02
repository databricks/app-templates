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
        return [res["choices"][0]]
    raise Exception("This app can only run against Databricks model serving endpoints that serve one of the conversational agent schemas documented in https://docs.databricks.com/aws/en/generative-ai/agent-framework/author-agent")


def query_endpoint(endpoint_name, messages, max_tokens):
    return _query_endpoint(endpoint_name, messages, max_tokens)[-1]
