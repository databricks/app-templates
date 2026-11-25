import logging
from datetime import datetime
from typing import AsyncGenerator
from uuid import uuid4

import mlflow
from databricks.sdk import WorkspaceClient
from google.adk.agents import LlmAgent
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from mlflow.genai.agent_server import invoke, stream
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    to_chat_completions_input,
)

from agent_server.utils import (
    build_instruction,
    get_bearer_token,
    get_databricks_host,
    get_session_id,
    get_user_workspace_client,
    instruction_provider,
    process_adk_events,
    seed_session_history,
)

logger = logging.getLogger(__name__)

# Google ADK drives the model through LiteLLM, so MLflow's LiteLLM autolog captures every
# model call as a span in the configured experiment (MLFLOW_EXPERIMENT_ID). Combined with the
# @invoke()/@stream() request trace, this gives full end-to-end traceability.
mlflow.litellm.autolog()
logging.getLogger("mlflow.utils.autologging_utils").setLevel(logging.ERROR)

sp_workspace_client = WorkspaceClient()

# Serving endpoint used as the agent's LLM. If you change it, also update the `llm-endpoint`
# resource in databricks.yml so the app's service principal can query the new endpoint.
LLM_ENDPOINT = "databricks-claude-sonnet-5-5"
APP_NAME = "agent_adk"
AGENT_NAME = "agent"
INSTRUCTION = "You are a helpful assistant."


def get_current_time() -> str:
    """Get the current date and time."""
    return datetime.now().isoformat()


def build_model(workspace_client: WorkspaceClient) -> LiteLlm:
    """Point ADK at Databricks model serving via its OpenAI-compatible API.

    LiteLLM's ``openai/`` provider POSTs to ``{api_base}/chat/completions`` with the endpoint
    name as the model, which is exactly the Databricks serving OpenAI-compatible surface.
    """
    host = get_databricks_host(workspace_client)
    token = get_bearer_token(workspace_client)
    return LiteLlm(
        model=f"openai/{LLM_ENDPOINT}",
        api_base=f"{host}/serving-endpoints",
        api_key=token,
    )


def create_agent(workspace_client: WorkspaceClient, instruction: str = INSTRUCTION) -> LlmAgent:
    tools = [get_current_time]
    # To give the agent Databricks-hosted MCP tools (UC functions, Genie, Vector Search, the
    # built-in code interpreter), add an MCPToolset. This needs the `mcp` package —
    # run `uv add "google-adk[mcp]"` — then:
    #   from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
    #   from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
    #   host, token = get_databricks_host(workspace_client), get_bearer_token(workspace_client)
    #   tools.append(MCPToolset(connection_params=StreamableHTTPConnectionParams(
    #       url=f"{host}/api/2.0/mcp/functions/system/ai",
    #       headers={"Authorization": f"Bearer {token}"},
    #   )))
    return LlmAgent(
        name=AGENT_NAME,
        model=build_model(workspace_client),
        instruction=instruction_provider(instruction),
        description="A helpful assistant that can answer questions and use tools.",
        tools=tools,
    )


@invoke()
async def invoke_handler(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    outputs = [
        event.item
        async for event in stream_handler(request)
        if event.type == "response.output_item.done"
    ]
    return ResponsesAgentResponse(output=outputs)


@stream()
async def stream_handler(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    session_id = get_session_id(request)
    if session_id:
        mlflow.update_current_trace(metadata={"mlflow.trace.session": session_id})

    # By default, uses service principal credentials.
    # For on-behalf-of user authentication, use get_user_workspace_client() instead:
    #   workspace_client = get_user_workspace_client()
    workspace_client = sp_workspace_client
    messages = to_chat_completions_input([i.model_dump() for i in request.input])
    # A client's system/developer items become part of this turn's instruction.
    agent = create_agent(workspace_client, build_instruction(INSTRUCTION, messages))

    # This template is stateless (the client carries conversation history in request.input).
    # Replay that history into a fresh ADK session and run the agent on the latest user turn.
    session_service = InMemorySessionService()
    adk_session_id = session_id or str(uuid4())
    user_id = "app-user"
    new_message = await seed_session_history(
        session_service, APP_NAME, user_id, adk_session_id, messages, AGENT_NAME
    )

    runner = Runner(agent=agent, app_name=APP_NAME, session_service=session_service)
    async for event in process_adk_events(
        runner.run_async(
            user_id=user_id,
            session_id=adk_session_id,
            new_message=new_message,
            run_config=RunConfig(streaming_mode=StreamingMode.SSE),
        )
    ):
        yield event
