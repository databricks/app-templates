import logging
import os
import uuid
from typing import Annotated, Any, Generator, Optional, Sequence, TypedDict

import mlflow
from databricks_langchain import (
    ChatDatabricks,
    UCFunctionToolkit,
    CheckpointSaver,
)
from databricks.sdk import WorkspaceClient
from langchain_core.messages import AIMessage, AIMessageChunk, AnyMessage
from langchain_core.runnables import RunnableConfig, RunnableLambda
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt.tool_node import ToolNode
from mlflow.genai.agent_server import invoke, stream
from mlflow.pyfunc import ResponsesAgent
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    output_to_responses_items_stream,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


def _ensure_annotations(item: Any) -> Any:
    """Ensure content items have an annotations field (required by frontend).
    
    The e2e-chatbot-app-next frontend expects all content items to have an
    'annotations' array, even if empty. This function adds it if missing.
    """
    if item is None:
        return item
    
    # Handle dict-like items
    if hasattr(item, 'model_dump'):
        item_dict = item.model_dump()
    elif isinstance(item, dict):
        item_dict = item
    else:
        return item
    
    # Add annotations to content items if missing
    if "content" in item_dict and isinstance(item_dict["content"], list):
        for content_item in item_dict["content"]:
            if isinstance(content_item, dict) and "annotations" not in content_item:
                content_item["annotations"] = []
    
    return item_dict

############################################
# Define your LLM endpoint and system prompt
############################################
# TODO: Replace with your model serving endpoint
LLM_ENDPOINT_NAME = "databricks-claude-sonnet-4-5"

# TODO: Update with your system prompt
SYSTEM_PROMPT = """You are a helpful assistant. Use the available tools to answer questions."""

############################################
# Lakebase configuration
############################################
LAKEBASE_INSTANCE_NAME = os.getenv("LAKEBASE_INSTANCE_NAME", "")

###############################################################################
# Define tools for your agent, enabling it to retrieve data or take actions
# beyond text generation
# To create and see usage examples of more tools, see
# https://docs.databricks.com/en/generative-ai/agent-framework/agent-tool.html
###############################################################################
tools = []

# Example UC tools; add your own as needed
UC_TOOL_NAMES: list[str] = []
if UC_TOOL_NAMES:
    uc_toolkit = UCFunctionToolkit(function_names=UC_TOOL_NAMES)
    tools.extend(uc_toolkit.tools)

# Use Databricks vector search indexes as tools
# See https://docs.databricks.com/en/generative-ai/agent-framework/unstructured-retrieval-tools.html
VECTOR_SEARCH_TOOLS = []
tools.extend(VECTOR_SEARCH_TOOLS)


#####################
# Define agent logic
#####################


class AgentState(TypedDict):
    """State for the agent graph."""
    messages: Annotated[Sequence[AnyMessage], add_messages]
    custom_inputs: Optional[dict[str, Any]]
    custom_outputs: Optional[dict[str, Any]]


class LangGraphResponsesAgent(ResponsesAgent):
    """Stateful agent using ResponsesAgent with pooled Lakebase checkpointing.
    
    This agent supports conversation threading through Lakebase's CheckpointSaver.
    Pass a `thread_id` in custom_inputs to resume a previous conversation, or
    let the system generate a new one automatically.
    
    Usage via API:
        # Start a new conversation (auto-generates thread_id)
        curl -X POST http://localhost:8000/invocations \\
            -H "Content-Type: application/json" \\
            -d '{"input": [{"role": "user", "content": "Hello!"}]}'
        
        # Continue an existing conversation
        curl -X POST http://localhost:8000/invocations \\
            -H "Content-Type: application/json" \\
            -d '{
                "input": [{"role": "user", "content": "What did we discuss?"}],
                "custom_inputs": {"thread_id": "your-thread-id-here"}
            }'
    """

    def __init__(self, lakebase_instance_name: str):
        self.lakebase_instance_name = lakebase_instance_name
        self.workspace_client = WorkspaceClient()

        self.model = ChatDatabricks(endpoint=LLM_ENDPOINT_NAME)
        self.system_prompt = SYSTEM_PROMPT
        self.model_with_tools = self.model.bind_tools(tools) if tools else self.model

        mlflow.langchain.autolog()

    def _create_graph(self, checkpointer: Any):
        """Create the LangGraph workflow with checkpointing support."""
        
        def should_continue(state: AgentState):
            """Determine if the agent should continue to tools or end."""
            messages = state["messages"]
            last_message = messages[-1]
            if isinstance(last_message, AIMessage) and last_message.tool_calls:
                return "continue"
            return "end"

        # Preprocessor to add system prompt
        preprocessor = (
            RunnableLambda(
                lambda state: [{"role": "system", "content": self.system_prompt}] + state["messages"]
            )
            if self.system_prompt
            else RunnableLambda(lambda state: state["messages"])
        )
        model_runnable = preprocessor | self.model_with_tools

        def call_model(state: AgentState, config: RunnableConfig):
            """Call the model with the current state."""
            response = model_runnable.invoke(state, config)
            return {"messages": [response]}

        # Build the workflow graph
        workflow = StateGraph(AgentState)
        workflow.add_node("agent", RunnableLambda(call_model))

        if tools:
            workflow.add_node("tools", ToolNode(tools))
            workflow.add_conditional_edges(
                "agent", should_continue, {"continue": "tools", "end": END}
            )
            workflow.add_edge("tools", "agent")
        else:
            workflow.add_edge("agent", END)

        workflow.set_entry_point("agent")
        return workflow.compile(checkpointer=checkpointer)

    def _get_or_create_thread_id(self, request: ResponsesAgentRequest) -> str:
        """Get thread_id from request or create a new one.

        Priority:
        1. Use thread_id from custom_inputs if present
        2. Use conversation_id from chat context if available
        3. Generate a new UUID

        Returns:
            thread_id: The thread identifier to use for this conversation
        """
        ci = dict(request.custom_inputs or {})

        # Check custom_inputs first
        if "thread_id" in ci:
            logger.info(f"Using thread_id from custom_inputs: {ci['thread_id']}")
            return ci["thread_id"]

        # Check conversation_id from chat context
        # https://mlflow.org/docs/latest/api_reference/python_api/mlflow.types.html#mlflow.types.agent.ChatContext
        if request.context and getattr(request.context, "conversation_id", None):
            logger.info(f"Using conversation_id from context: {request.context.conversation_id}")
            return request.context.conversation_id

        # Generate new thread_id
        new_thread_id = str(uuid.uuid4())
        logger.info(f"Generated new thread_id: {new_thread_id}")
        return new_thread_id

    def predict(self, request: ResponsesAgentRequest) -> ResponsesAgentResponse:
        """Non-streaming prediction that collects all events from the stream."""
        outputs = []
        for event in self.predict_stream(request):
            if event.type == "response.output_item.done":
                # Ensure annotations field is present (required by frontend)
                item = _ensure_annotations(event.item)
                outputs.append(item)
        
        # Include thread_id in custom_outputs so caller knows which thread was used
        custom_outputs = dict(request.custom_inputs or {})
        return ResponsesAgentResponse(output=outputs, custom_outputs=custom_outputs)

    def predict_stream(
        self, request: ResponsesAgentRequest
    ) -> Generator[ResponsesAgentStreamEvent, None, None]:
        """Streaming prediction with Lakebase checkpointing for conversation history."""
        
        # Get or create thread_id
        thread_id = self._get_or_create_thread_id(request)
        
        # Update custom_inputs with thread_id so it's available in response
        ci = dict(request.custom_inputs or {})
        ci["thread_id"] = thread_id
        request.custom_inputs = ci

        logger.info(f"Starting message stream for chat with thread_id: {thread_id}")

        cc_msgs = self.prep_msgs_for_cc_llm([i.model_dump() for i in request.input])
        langchain_msgs = cc_msgs
        checkpoint_config = {"configurable": {"thread_id": thread_id}}

        # Use CheckpointSaver context manager for Lakebase checkpointing
        with CheckpointSaver(instance_name=self.lakebase_instance_name) as checkpointer:
            graph = self._create_graph(checkpointer)

            for event in graph.stream(
                {"messages": langchain_msgs},
                checkpoint_config,
                stream_mode=["updates", "messages"],
            ):
                if event[0] == "updates":
                    for node_data in event[1].values():
                        if len(node_data.get("messages", [])) > 0:
                            yield from output_to_responses_items_stream(node_data["messages"])
                elif event[0] == "messages":
                    try:
                        chunk = event[1][0]
                        if isinstance(chunk, AIMessageChunk) and chunk.content:
                            yield ResponsesAgentStreamEvent(
                                **self.create_text_delta(delta=chunk.content, item_id=chunk.id),
                            )
                    except Exception as exc:
                        logger.error("Error streaming chunk: %s", exc)
        
        logger.info(f"Finished message stream! thread_id: {thread_id}")


# ----- Validate configuration -----
if not LAKEBASE_INSTANCE_NAME:
    raise ValueError(
        "LAKEBASE_INSTANCE_NAME is not set. Please set it in the agent.py file or "
        "via the LAKEBASE_INSTANCE_NAME environment variable. "
        "You can create a Lakebase instance in your Databricks workspace."
    )


# ----- First-time checkpoint table setup -----
def _setup_checkpoint_tables():
    """Initialize Lakebase checkpoint tables if they don't exist.
    
    This is idempotent - safe to call multiple times. Tables are only
    created if they don't already exist.
    """
    try:
        logger.info(f"Setting up checkpoint tables for Lakebase instance: {LAKEBASE_INSTANCE_NAME}")
        with CheckpointSaver(instance_name=LAKEBASE_INSTANCE_NAME) as saver:
            saver.setup()
        logger.info("✅ Checkpoint tables are ready.")
    except Exception as e:
        logger.error(f"Failed to setup checkpoint tables: {e}")
        raise RuntimeError(
            f"Could not initialize Lakebase checkpoint tables for instance '{LAKEBASE_INSTANCE_NAME}'. "
            f"Please verify the instance exists and you have proper permissions. Error: {e}"
        ) from e


# Run setup on module load (first import)
_setup_checkpoint_tables()


# ----- Export model -----
AGENT = LangGraphResponsesAgent(LAKEBASE_INSTANCE_NAME)

# ----- Register invoke and stream functions with MLflow AgentServer -----
@invoke()
def handle_invoke(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    """Handle non-streaming invocation requests."""
    return AGENT.predict(request)


@stream()
def handle_stream(request: ResponsesAgentRequest) -> Generator[ResponsesAgentStreamEvent, None, None]:
    """Handle streaming invocation requests."""
    yield from AGENT.predict_stream(request)

# ----- Export model -----
mlflow.models.set_model(AGENT)
