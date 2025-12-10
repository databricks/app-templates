import json
import logging
import os
from typing import Annotated, Any, Generator, Optional, Sequence, TypedDict

import mlflow
from databricks_langchain import (
    ChatDatabricks,
    DatabricksStore,
    UCFunctionToolkit,
)
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
)
from langchain_core.runnables import RunnableConfig, RunnableLambda
from langchain_core.tools import tool
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
SYSTEM_PROMPT = """You are a helpful assistant with long-term memory capabilities.

You have access to tools that let you save, retrieve, and delete information about the user.
Use these tools to remember important details the user shares (preferences, facts, etc.)
and to recall them when relevant to the conversation.

When a user shares personal information or preferences, proactively save it to memory.
When answering questions, check if you have relevant memories about the user."""

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
    messages: Annotated[Sequence[BaseMessage], add_messages]
    custom_inputs: Optional[dict[str, Any]]
    custom_outputs: Optional[dict[str, Any]]
    user_id: Optional[str]


class LangGraphResponsesAgent(ResponsesAgent):
    """Stateless agent using ResponsesAgent with user-based long-term memory.

    Features:
    - Connection pooling with credential rotation via DatabricksStore
    - User-based long-term memory persistence (memories stored per user_id)
    - Memory tools: get_user_memory, save_user_memory, delete_user_memory
    - Automatic connection management for scalability
    
    Usage via API:
        # Request with user context (required for memory features)
        curl -X POST http://localhost:8000/invocations \\
            -H "Content-Type: application/json" \\
            -d '{
                "input": [{"role": "user", "content": "Remember my favorite color is purple"}],
                "context": {"user_id": "user@example.com"}
            }'
        
        # Later, retrieve the memory
        curl -X POST http://localhost:8000/invocations \\
            -H "Content-Type: application/json" \\
            -d '{
                "input": [{"role": "user", "content": "What is my favorite color?"}],
                "context": {"user_id": "user@example.com"}
            }'
    """

    def __init__(self):
        self.lakebase_instance_name = LAKEBASE_INSTANCE_NAME
        self.system_prompt = SYSTEM_PROMPT
        self.model = ChatDatabricks(endpoint=LLM_ENDPOINT_NAME)

        self._store = None
        self._memory_tools = None

        mlflow.langchain.autolog()

    @property
    def store(self):
        """Lazy initialization of DatabricksStore."""
        if self._store is None:
            logger.info(f"Initializing DatabricksStore with instance: {self.lakebase_instance_name}")
            self._store = DatabricksStore(instance_name=self.lakebase_instance_name)
        return self._store

    @property
    def memory_tools(self):
        """Lazy initialization of memory tools."""
        if self._memory_tools is None:
            logger.info("Creating memory tools")
            self._memory_tools = self._create_memory_tools()
        return self._memory_tools

    @property
    def model_with_all_tools(self):
        all_tools = tools + self.memory_tools
        return self.model.bind_tools(all_tools) if all_tools else self.model

    def _create_memory_tools(self):
        """Create tools for reading and writing long-term memory."""

        @tool
        def get_user_memory(query: str, config: RunnableConfig) -> str:
            """Look up information about the user from long-term memory.

            Use this tool to retrieve previously saved information about the user,
            such as their preferences, facts they've shared, or other personal details.

            Args:
                query: A description of what information you're looking for (e.g., "user preferences", "favorite color")
            """
            user_id = config.get("configurable", {}).get("user_id")
            if not user_id:
                return "Memory not available - no user_id provided."

            namespace = user_id.replace(".", "-")

            results = self.store.search(namespace, query=query, limit=5)

            if not results:
                return "No memories found for this user."

            memory_items = []
            for item in results:
                memory_items.append(f"- {json.dumps(item.value)}")

            return "User memories:\n" + "\n".join(memory_items)

        @tool
        def save_user_memory(memory_key: str, memory_data_json: str, config: RunnableConfig) -> str:
            """Save information about the user to long-term memory.

            Use this tool to remember important information the user shares about themselves,
            such as preferences, facts, or other personal details.

            Args:
                memory_key: A descriptive key for this memory (e.g., "preferences", "favorite_color", "background_info")
                memory_data_json: JSON string with the information to remember.
                    Example: '{"favorite_color": "purple"}'
            """
            user_id = config.get("configurable", {}).get("user_id")
            if not user_id:
                return "Cannot save memory - no user_id provided."

            namespace = user_id.replace(".", "-")

            try:
                memory_data = json.loads(memory_data_json)
                # Validate that memory_data is a dictionary (not a list or other type)
                if not isinstance(memory_data, dict):
                    return f"Failed to save memory: memory_data must be a JSON object (dictionary), not {type(memory_data).__name__}. Example: '{{\"key\": \"value\"}}'"
                self.store.put(namespace, memory_key, memory_data)
                return f"Successfully saved memory with key '{memory_key}' for user."
            except json.JSONDecodeError as e:
                return f"Failed to save memory: Invalid JSON format - {str(e)}"

        @tool
        def delete_user_memory(memory_key: str, config: RunnableConfig) -> str:
            """Delete a specific memory from the user's long-term memory.

            Use this tool when the user asks you to forget something or remove
            a piece of information from their memory.

            Args:
                memory_key: The key of the memory to delete (e.g., "preferences", "likes", "background_info")
            """
            user_id = config.get("configurable", {}).get("user_id")
            if not user_id:
                return "Cannot delete memory - no user_id provided."

            namespace = user_id.replace(".", "-")

            self.store.delete(namespace, memory_key)
            return f"Successfully deleted memory with key '{memory_key}' for user."

        return [get_user_memory, save_user_memory, delete_user_memory]

    def _create_graph(self):
        """Create the LangGraph workflow"""
        def should_continue(state: AgentState):
            messages = state["messages"]
            last_message = messages[-1]
            if isinstance(last_message, AIMessage) and last_message.tool_calls:
                return "continue"
            return "end"

        model_with_tools = self.model_with_all_tools

        if self.system_prompt:
            preprocessor = RunnableLambda(
                lambda state: [{"role": "system", "content": self.system_prompt}] + state["messages"]
            )
        else:
            preprocessor = RunnableLambda(lambda state: state["messages"])

        model_runnable = preprocessor | model_with_tools

        def call_model(state: AgentState, config: RunnableConfig):
            response = model_runnable.invoke(state, config)
            return {"messages": [response]}

        workflow = StateGraph(AgentState)
        workflow.add_node("agent", RunnableLambda(call_model))

        active_tools = tools + self.memory_tools

        if active_tools:
            workflow.add_node("tools", ToolNode(active_tools))
            workflow.add_conditional_edges(
                "agent",
                should_continue,
                {"continue": "tools", "end": END}
            )
            workflow.add_edge("tools", "agent")
        else:
            workflow.add_edge("agent", END)

        workflow.set_entry_point("agent")

        return workflow.compile()

    def _get_user_id(self, request: ResponsesAgentRequest) -> Optional[str]:
        """
        Get user_id from chat context if available, return None if not provided.
        
        The user_id is used to namespace memories per user.
        See: https://mlflow.org/docs/latest/api_reference/python_api/mlflow.types.html#mlflow.types.agent.ChatContext
        """
        if request.context and getattr(request.context, "user_id", None):
            return request.context.user_id
        return None

    def predict(self, request: ResponsesAgentRequest) -> ResponsesAgentResponse:
        """Non-streaming prediction"""
        user_id = self._get_user_id(request)

        if not user_id:
            logger.warning(
                "No user_id provided in request context. Memory features will be disabled. "
                "To use long-term memory, include 'context': {'user_id': 'your-user-id'} in the request."
            )

        outputs = []
        for event in self.predict_stream(request):
            if event.type == "response.output_item.done":
                # Ensure annotations field is present (required by frontend)
                item = _ensure_annotations(event.item)
                outputs.append(item)

        return ResponsesAgentResponse(output=outputs)

    def predict_stream(
        self,
        request: ResponsesAgentRequest,
    ) -> Generator[ResponsesAgentStreamEvent, None, None]:
        """Streaming prediction with user-based long-term memory."""
        user_id = self._get_user_id(request)

        if not user_id:
            logger.warning(
                "No user_id provided in request context. Memory features will be disabled."
            )

        logger.info(f"Starting message stream for user_id: {user_id}")

        # Prepare messages
        cc_msgs = self.prep_msgs_for_cc_llm([i.model_dump() for i in request.input])

        # Configure run with user_id for memory tools
        run_config = {"configurable": {}}
        if user_id:
            run_config["configurable"]["user_id"] = user_id

        graph = self._create_graph()

        state_input = {"messages": cc_msgs}
        if user_id:
            state_input["user_id"] = user_id

        # Stream the graph execution
        for event in graph.stream(
            state_input,
            run_config,
            stream_mode=["updates", "messages"]
        ):
            if event[0] == "updates":
                for node_data in event[1].values():
                    if len(node_data.get("messages", [])) > 0:
                        yield from output_to_responses_items_stream(node_data["messages"])
            # Stream message chunks for real-time text generation
            elif event[0] == "messages":
                try:
                    chunk = event[1][0]
                    if isinstance(chunk, AIMessageChunk) and (content := chunk.content):
                        yield ResponsesAgentStreamEvent(
                            **self.create_text_delta(delta=content, item_id=chunk.id),
                        )
                except Exception as e:
                    logger.error(f"Error streaming chunk: {e}")

        logger.info(f"Finished message stream for user_id: {user_id}")


# ----- Validate configuration -----
if not LAKEBASE_INSTANCE_NAME:
    raise ValueError(
        "LAKEBASE_INSTANCE_NAME is not set. Please set it in the agent.py file or "
        "via the LAKEBASE_INSTANCE_NAME environment variable. "
        "You can create a Lakebase instance in your Databricks workspace."
    )


# ----- First-time store table setup -----
def _setup_store_tables():
    """Initialize Lakebase store tables if they don't exist.
    
    This is idempotent - safe to call multiple times. Tables are only
    created if they don't already exist.
    """
    try:
        logger.info(f"Setting up store tables for Lakebase instance: {LAKEBASE_INSTANCE_NAME}")
        store = DatabricksStore(instance_name=LAKEBASE_INSTANCE_NAME)
        store.setup()
        logger.info("✅ Store tables are ready.")
    except Exception as e:
        logger.error(f"Failed to setup store tables: {e}")
        raise RuntimeError(
            f"Could not initialize Lakebase store tables for instance '{LAKEBASE_INSTANCE_NAME}'. "
            f"Please verify the instance exists and you have proper permissions. Error: {e}"
        ) from e


# Run setup on module load (first import)
_setup_store_tables()


# ----- Export model -----
AGENT = LangGraphResponsesAgent()

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
