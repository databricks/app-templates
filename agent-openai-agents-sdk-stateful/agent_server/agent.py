from typing import AsyncGenerator, Optional
import os
import uuid_utils
import mlflow
from agents import Agent, Runner, set_default_openai_api, set_default_openai_client
from agents.tracing import set_trace_processors
from databricks_openai import AsyncDatabricksOpenAI
from databricks_openai.agents import McpServer
from databricks_openai.agents.session import AsyncMemorySession
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)

from agent_server.utils import (
    get_databricks_host_from_env,
    get_user_workspace_client,
    process_agent_stream_events,
)

# NOTE: this will work for all databricks models OTHER than GPT-OSS, which uses a slightly different API
set_default_openai_client(AsyncDatabricksOpenAI())
set_default_openai_api("chat_completions")
set_trace_processors([])  # only use mlflow for trace processing
mlflow.openai.autolog()

LAKEBASE_INSTANCE_NAME = os.getenv("LAKEBASE_INSTANCE_NAME", "")
print("lakebase instance name is")
print(LAKEBASE_INSTANCE_NAME)

if not LAKEBASE_INSTANCE_NAME:
    raise ValueError(
        "LAKEBASE_INSTANCE_NAME environment variable is required but not set. "
        "Please set it in your environment:\n"
        "  LAKEBASE_INSTANCE_NAME=<your-lakebase-instance-name>\n"
    )


async def init_mcp_server():
    return McpServer(
        url=f"{get_databricks_host_from_env()}/api/2.0/mcp/functions/system/ai",
        name="system.ai uc function mcp server",
    )


def create_coding_agent(mcp_server: McpServer) -> Agent:
    return Agent(
        name="assistant",
        instructions="""You are a helpful assistant. You have access to a Python code execution tool
        that you can use when needed for mathematical calculations, data analysis
        and running code the user asks you to execute. For general conversation, questions,
         and discussions, respond directly without using tools.""",
        model="databricks-gpt-5-2",
        mcp_servers=[mcp_server],
    )

def extract_session_id(request: ResponsesAgentRequest) -> Optional[str]:
    """
    Extract session_id from custom_inputs if present. 
    """
    if hasattr(request, "custom_inputs") and request.custom_inputs:
        return request.custom_inputs.get("session_id")
    return None


def extract_latest_user_message(request: ResponsesAgentRequest) -> str:
    """
    Extract the latest user message content as a string.
    
    When using session memory, the OpenAI Agents SDK expects a string input
    (the new user message). The session handles conversation history.
    """
    # Find the last user message in the input
    for item in reversed(request.input):
        item_dict = item.model_dump()
        if item_dict.get("role") == "user":
            content = item_dict.get("content")
            # Handle both string content and structured content
            if isinstance(content, str):
                return content
            elif isinstance(content, list):
                # Extract text from structured content (e.g., [{"type": "input_text", "text": "..."}])
                for part in content:
                    if isinstance(part, dict):
                        if part.get("type") in ("input_text", "text"):
                            return part.get("text", "")
                        elif "text" in part:
                            return part["text"]
    return ""


def get_session(session_id: Optional[str] = None) -> tuple[AsyncMemorySession, str]:
    """
    Get or create a AsyncMemorySession for the given session_id.
    
    Args:
        session_id: Optional session ID. Can be any meaningful identifier for user, thread, or context.
            If not provided, a new UUID is generated.
            
    Returns:
        A tuple of (session, session_id) where session_id is the resolved ID.
    """
    if not LAKEBASE_INSTANCE_NAME:
        raise ValueError(
            "LAKEBASE_INSTANCE_NAME environment variable is not set. "
            "Please set it to your Lakebase instance name for session memory."
        )
    
    # Generate new session_id if not provided
    resolved_session_id = session_id or str(uuid_utils.uuid7())
    
    session = AsyncMemorySession(
        session_id=resolved_session_id,
        instance_name=LAKEBASE_INSTANCE_NAME,
    )
    
    return session, resolved_session_id

@invoke()
async def invoke(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    """
    Handle non-streaming agent invocation with stateful session memory.
    
    Supports session_id in custom_inputs for conversation continuity.
    The session_id can be any meaningful identifier:
    - User-based: "user_12345"
    - Thread-based: "thread_abc123"
    - Context-based: "support_ticket_456"
    
    If session_id is not provided, a new UUID is generated and returned.
    """
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()
    
    session_id = extract_session_id(request)
    
    async with await init_mcp_server() as mcp_server:
        agent = create_coding_agent(mcp_server)
        user_message = extract_latest_user_message(request)
        session, resolved_session_id = get_session(session_id)
        result = await Runner.run(agent, user_message, session=session)
        return ResponsesAgentResponse(
            output=[item.to_input_item() for item in result.new_items],
            custom_outputs={"session_id": resolved_session_id},
        )


@stream()
async def stream(request: ResponsesAgentRequest) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    """
    Handle streaming agent invocation with stateful session memory.
    
    Supports session_id in custom_inputs for conversation continuity.
    The session_id can be any meaningful identifier:
    - User-based: "user_12345"
    - Thread-based: "thread_abc123"
    - Context-based: "support_ticket_456"
    
    If session_id is not provided, a new UUID is generated and returned.
    """
    # Optionally use the user's workspace client for on-behalf-of authentication
    # user_workspace_client = get_user_workspace_client()
    
    session_id = extract_session_id(request)
    
    async with await init_mcp_server() as mcp_server:
        agent = create_coding_agent(mcp_server)
        user_message = extract_latest_user_message(request)
        session, resolved_session_id = get_session(session_id)
        result = Runner.run_streamed(agent, input=user_message, session=session)

        async for event in process_agent_stream_events(result.stream_events()):
            yield event
        
        yield ResponsesAgentStreamEvent(
            type="response.done",
            response={
                "custom_outputs": {"session_id": resolved_session_id}
            }
        )
