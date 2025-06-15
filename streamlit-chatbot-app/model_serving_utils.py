from mlflow.deployments import get_deploy_client
from databricks.sdk import WorkspaceClient
import json
import requests
import os

def _get_endpoint_task_type(endpoint_name: str) -> str:
    """Get the task type of a serving endpoint."""
    try:
        w = WorkspaceClient()
        ep = w.serving_endpoints.get(endpoint_name)
        return ep.task if ep.task else "chat/completions"
    except Exception:
        return "chat/completions"

def _query_endpoint(endpoint_name: str, messages: list[dict[str, str]], max_tokens) -> list[dict[str, str]]:
    """Calls a model serving endpoint."""
    task_type = _get_endpoint_task_type(endpoint_name)
    
    if task_type == "agent/v1/responses":
        return _query_responses_endpoint(endpoint_name, messages, max_tokens)
    else:
        return _query_chat_endpoint(endpoint_name, messages, max_tokens)

def _query_chat_endpoint(endpoint_name: str, messages: list[dict[str, str]], max_tokens) -> list[dict[str, str]]:
    """Query chat/completions or agent endpoints."""
    res = get_deploy_client('databricks://ml-models-dev').predict(
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
                    "in https://docs.databricks.com/aws/en/generative-ai/agent-framework/author-agent"
                    "3) Databricks agent serving endpoints with agent/v1/responses task type")

def _query_responses_endpoint(endpoint_name: str, messages: list[dict[str, str]], max_tokens) -> list[dict[str, str]]:
    """Query agent/v1/responses endpoints."""
    payload = {
        "input": messages,
        "stream": False
    }
    
    res = get_deploy_client('databricks://ml-models-dev').predict(
        endpoint=endpoint_name,
        inputs=payload,
    )
    
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
                    return [{"role": "assistant", "content": text_content}]
        return [{"role": "assistant", "content": "No response found"}]
    
    raise Exception("Unexpected response format from agent/v1/responses endpoint")

def query_endpoint(endpoint_name, messages, max_tokens):
    """
    Query a chat-completions or agent serving endpoint
    If querying an agent serving endpoint that returns multiple messages, this method
    returns the last message
    ."""
    return _query_endpoint(endpoint_name, messages, max_tokens)[-1]

def query_endpoint_stream(endpoint_name: str, messages: list[dict[str, str]], max_tokens: int):
    """
    Query an endpoint with streaming support.
    Returns a generator that yields response chunks for streaming display.
    """
    task_type = _get_endpoint_task_type(endpoint_name)
    
    if task_type == "agent/v1/responses":
        return _query_responses_endpoint_stream(endpoint_name, messages, max_tokens)
    else:
        # For non-responses endpoints, fall back to non-streaming
        result = query_endpoint(endpoint_name, messages, max_tokens)
        yield result["content"]

def _query_responses_endpoint_stream(endpoint_name: str, messages: list[dict[str, str]], max_tokens: int):
    """Stream responses from agent/v1/responses endpoints."""
    try:
        w = WorkspaceClient()
        endpoint_url = f"{w.config.host}/serving-endpoints/{endpoint_name}/invocations"
        
        payload = {
            "input": messages,
            "stream": True
        }
        
        headers = {
            "Authorization": f"Bearer {w.config.token}",
            "Content-Type": "application/json"
        }
        
        response = requests.post(endpoint_url, json=payload, headers=headers, stream=True)
        response.raise_for_status()
        
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
                                            yield text
                    except json.JSONDecodeError:
                        continue
                        
    except Exception as e:
        # Fall back to non-streaming if streaming fails
        result = _query_responses_endpoint(endpoint_name, messages, max_tokens)
        if result:
            yield result[0]["content"]
