from mlflow.deployments import get_deploy_client
from databricks.sdk import WorkspaceClient
import json
import uuid
import requests

def _get_endpoint_task_type(endpoint_name: str) -> str:
    """Get the task type of a serving endpoint."""
    try:
        w = WorkspaceClient()
        ep = w.serving_endpoints.get(endpoint_name)
        return ep.task if ep.task else "chat/completions"
    except Exception:
        return "chat/completions"

def _throw_unexpected_endpoint_format():
    raise Exception("This app can only run against:"
                    "1) Databricks foundation model or external model endpoints with the chat task type (described in https://docs.databricks.com/aws/en/machine-learning/model-serving/score-foundation-models#chat-completion-model-query)\n"
                    "2) Databricks agent serving endpoints that implement the conversational agent schema documented "
                    "in https://docs.databricks.com/aws/en/generative-ai/agent-framework/author-agent\n"
                    "3) Databricks agent serving endpoints with agent/v1/responses task type")



def query_endpoint_stream(endpoint_name: str, messages: list[dict[str, str]], max_tokens: int, return_traces: bool):
    """Streams chat-completions style chunks and converts to ChatAgent-style streaming deltas."""
    task_type = _get_endpoint_task_type(endpoint_name)
    
    if task_type == "agent/v1/responses":
        return _query_responses_endpoint_stream(endpoint_name, messages, max_tokens, return_traces)
    else:
        return _query_chat_endpoint_stream(endpoint_name, messages, max_tokens, return_traces)

def _query_chat_endpoint_stream(endpoint_name: str, messages: list[dict[str, str]], max_tokens: int, return_traces: bool):
    """Streams chat-completions style chunks and converts to ChatAgent-style streaming deltas."""
    client = get_deploy_client("databricks://ml-models-dev")

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

def _query_responses_endpoint_stream(endpoint_name: str, messages: list[dict[str, str]], max_tokens: int, return_traces: bool):
    """Stream responses from agent/v1/responses endpoints."""
    try:
        w = WorkspaceClient()
        endpoint_url = f"{w.config.host}/serving-endpoints/{endpoint_name}/invocations"
        
        payload = {
            "input": messages,
            "stream": True
        }
        if return_traces:
            payload["databricks_options"] = {"return_trace": True}
        
        headers = {
            "Authorization": f"Bearer {w.config.token}",
            "Content-Type": "application/json"
        }
        
        response = requests.post(endpoint_url, json=payload, headers=headers, stream=True)
        response.raise_for_status()
        
        stream_id = str(uuid.uuid4())
        
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith('data: '):
                    data_str = line_str[6:]
                    if data_str.strip() == '[DONE]':
                        break
                    
                    try:
                        data = json.loads(data_str)
                        if data.get("type") == "response.output_item.done":
                            item = data.get("item", {})
                            if (item.get("type") == "message" and 
                                item.get("role") == "assistant"):
                                content = item.get("content", [])
                                for c in content:
                                    if c.get("type") == "output_text":
                                        text = c.get("text", "")
                                        if text:
                                            yield {
                                                "delta": {
                                                    "role": "assistant",
                                                    "content": text,
                                                    "id": stream_id
                                                },
                                            }
                    except json.JSONDecodeError:
                        continue
                        
    except Exception as e:
        # Fall back to non-streaming if streaming fails
        result, request_id = _query_responses_endpoint(endpoint_name, messages, max_tokens, return_traces)
        if result:
            yield {
                "delta": {
                    "role": "assistant", 
                    "content": result[0]["content"],
                    "id": str(uuid.uuid4())
                }
            }

def query_endpoint(endpoint_name, messages, max_tokens, return_traces):
    """
    Query an endpoint, returning the string message content and request
    ID for feedback
    """
    task_type = _get_endpoint_task_type(endpoint_name)
    
    if task_type == "agent/v1/responses":
        return _query_responses_endpoint(endpoint_name, messages, max_tokens, return_traces)
    else:
        return _query_chat_endpoint(endpoint_name, messages, max_tokens, return_traces)

def _query_chat_endpoint(endpoint_name, messages, max_tokens, return_traces):
    """Calls a model serving endpoint with chat/completions format."""
    inputs = {'messages': messages, "max_tokens": max_tokens}
    if return_traces:
        inputs['databricks_options'] = {'return_trace': True}
    
    res = get_deploy_client('databricks://ml-models-dev').predict(
        endpoint=endpoint_name,
        inputs=inputs,
    )
    request_id = res.get("databricks_output", {}).get("databricks_request_id")
    if "messages" in res:
        return res["messages"], request_id
    elif "choices" in res:
        return [res["choices"][0]["message"]], request_id
    _throw_unexpected_endpoint_format()

def _query_responses_endpoint(endpoint_name, messages, max_tokens, return_traces):
    """Query agent/v1/responses endpoints."""
    payload = {
        "input": messages,
        "stream": False
    }
    if return_traces:
        payload["databricks_options"] = {"return_trace": True}
    
    res = get_deploy_client('databricks://ml-models-dev').predict(
        endpoint=endpoint_name,
        inputs=payload,
    )
    
    request_id = res.get("databricks_output", {}).get("databricks_request_id")
    
    if "output" in res:
        # Extract the final assistant message from the output
        for item in reversed(res["output"]):
            if item.get("type") == "message" and item.get("role") == "assistant":
                content = item.get("content", [])
                if content and isinstance(content, list):
                    text_content = ""
                    for c in content:
                        if c.get("type") == "output_text":
                            text_content += c.get("text", "")
                    return [{"role": "assistant", "content": text_content}], request_id
        return [{"role": "assistant", "content": "No response found"}], request_id
    
    _throw_unexpected_endpoint_format()

def submit_feedback(endpoint, request_id, rating):
    """Submit feedback to the agent."""
    rating_string = "positive" if rating == 1 else "negative"
    text_assessments = [] if rating is None else [{
        "ratings": {
            "answer_correct": {"value": rating_string},
        },
        "free_text_comment": None
    }]

    proxy_payload = {
        "dataframe_records": [
            {
                "source": json.dumps({
                    "id": "e2e-chatbot-app",  # Or extract from auth
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
