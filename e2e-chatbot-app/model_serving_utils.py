from mlflow.deployments import get_deploy_client
from databricks.sdk import WorkspaceClient
import json
import uuid

def _throw_unexpected_endpoint_format():
    raise Exception("This app can only run against:"
                    "1) Databricks foundation model or external model endpoints with the chat task type (described in https://docs.databricks.com/aws/en/machine-learning/model-serving/score-foundation-models#chat-completion-model-query)\n"
                    "2) Databricks agent serving endpoints that implement the conversational agent schema documented "
                    "in https://docs.databricks.com/aws/en/generative-ai/agent-framework/author-agent")



def query_endpoint_stream(endpoint_name: str, messages: list[dict[str, str]], max_tokens: int, return_traces: bool):
    """Streams chat-completions style chunks and converts to ChatAgent-style streaming deltas."""
    client = get_deploy_client("databricks")

    # Prepare input payload
    inputs = {
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if return_traces:
        inputs["databricks_options"] = {"return_trace": True}

    stream_id = str(uuid.uuid4())  # Generate unique ID for the stream

    for chunk in client.predict_stream(endpoint=endpoint_name, inputs=inputs):
        if "choices" in chunk:
            choices = chunk["choices"]
            if len(choices) > 0:
                # Convert from chat completions to ChatAgent format
                content = choices[0]["delta"].get("content", "")
                if content:
                    yield {
                        "delta": {
                            "role": "assistant",
                            "content": content,
                            "id": stream_id
                        },
                    }
        elif "delta" in chunk:
            # Yield the ChatAgentChunk directly
            yield chunk
        else:
            _throw_unexpected_endpoint_format()

def query_endpoint(endpoint_name, messages, max_tokens, return_traces):
    """
    Query an endpoint, returning the string message content and request
    ID for feedback
    """
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
    _throw_unexpected_endpoint_format()

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
