from mlflow.deployments import get_deploy_client
from databricks.sdk import WorkspaceClient
import json

def _query_endpoint(endpoint_name: str, messages: list[dict[str, str]], max_tokens, return_traces) -> list[dict[str, str]]:
    """Calls a model serving endpoint."""
    inputs={'messages': messages, "max_tokens": max_tokens},
    if return_traces:
        inputs['databricks_options'] = {'return_trace': True}
    res = get_deploy_client('databricks').predict(
        endpoint=endpoint_name,
        inputs={'messages': messages, "max_tokens": max_tokens},
    )
    request_id = res.get("databricks_output", {}).get("databricks_request_id")
    if "messages" in res:
        return res["messages"], request_id
    elif "choices" in res:
        return [res["choices"][0]["message"]], request_id
    raise Exception("This app can only run against:"
                    "1) Databricks foundation model or external model endpoints with the chat task type (described in https://docs.databricks.com/aws/en/machine-learning/model-serving/score-foundation-models#chat-completion-model-query)"
                    "2) Databricks agent serving endpoints that implement the conversational agent schema documented "
                    "in https://docs.databricks.com/aws/en/generative-ai/agent-framework/author-agent")

def query_endpoint(endpoint_name, messages, max_tokens, return_traces):
    """
    Query an endpoint, returning the string message content and request
    ID for feedback
    """
    response_messages, request_id = _query_endpoint(endpoint_name, messages, max_tokens, return_traces)
    # TODO: render intermediate tool calls as well
    return response_messages[-1], request_id


def submit_feedback(endpoint, request_id, rating):
    """Submit feedback to the agent."""
    text_assessments = [] if rating is None else [{
        "ratings": {
            "answer_correct": {"value": rating},
        },
        "free_text_comment": None
    }]

    proxy_payload = {
        "dataframe_records": [
            {
                "source": json.dumps({
                    "id": "user@company.com",  # Or extract from auth
                    "type": "human"
                }),
                "request_id": request_id,
                "text_assessments": json.dumps(text_assessments),
                "retrieval_assessments": json.dumps([]),
            }
        ]
    }

    w = WorkspaceClient()
    return w.api_client.do(
        method='POST',
        path=f"/serving-endpoints/{endpoint}/served-models/feedback/invocations",
        body=proxy_payload,
    )


def endpoint_supports_feedback(endpoint_name):
    w = WorkspaceClient()
    endpoint = w.serving_endpoints.get(endpoint_name)
    return "feedback" in [entity.entity_name for entity in endpoint.config.served_entities]

