import json
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional, Sequence, Tuple

from databricks_langchain import AsyncCheckpointSaver, AsyncDatabricksStore
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.store.base import BaseStore
from langgraph.checkpoint.base import BaseCheckpointSaver
from mlflow.entities import SpanType
from mlflow.types.responses import ResponsesAgentRequest

from agent_server.utils import _is_databricks_app_env
from agent_server.tracing import traced_async_operation, traced_operation

logger = logging.getLogger(__name__)

# Long-lived Lakebase resources, opened once at app startup in start_server.py's
# lifespan and reused across all requests.
_lakebase_resources: Optional[Tuple[AsyncCheckpointSaver, AsyncDatabricksStore]] = None


class TracedCheckpointSaver(BaseCheckpointSaver):
    """Delegate Lakebase checkpoints while tracing every read and write."""

    def __init__(self, delegate: Any):
        super().__init__(serde=delegate.serde)
        self._delegate = delegate

    @property
    def config_specs(self):
        return self._delegate.config_specs

    async def aget_tuple(self, config):
        async with traced_async_operation(
            "lakebase.checkpoint.read", SpanType.MEMORY, {"config": config}
        ) as operation:
            result = await self._delegate.aget_tuple(config)
            operation.set_outputs({"checkpoint": result})
            return result

    async def alist(
        self, config, *, filter=None, before=None, limit=None
    ) -> AsyncIterator[Any]:
        async with traced_async_operation(
            "lakebase.checkpoint.list",
            SpanType.MEMORY,
            {"config": config, "filter": filter, "before": before, "limit": limit},
        ) as operation:
            results = []
            async for item in self._delegate.alist(
                config, filter=filter, before=before, limit=limit
            ):
                results.append(item)
                yield item
            operation.set_outputs({"checkpoints": results})

    async def aput(self, config, checkpoint, metadata, new_versions):
        async with traced_async_operation(
            "lakebase.checkpoint.write",
            SpanType.MEMORY,
            {
                "config": config,
                "checkpoint": checkpoint,
                "metadata": metadata,
                "new_versions": new_versions,
            },
        ) as operation:
            result = await self._delegate.aput(
                config, checkpoint, metadata, new_versions
            )
            operation.set_outputs({"config": result})
            return result

    async def aput_writes(
        self,
        config,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        async with traced_async_operation(
            "lakebase.checkpoint.write_batch",
            SpanType.MEMORY,
            {
                "config": config,
                "writes": writes,
                "task_id": task_id,
                "task_path": task_path,
            },
        ) as operation:
            await self._delegate.aput_writes(config, writes, task_id, task_path)
            operation.set_outputs({"written": len(writes)})

    async def adelete_thread(self, thread_id: str) -> None:
        async with traced_async_operation(
            "lakebase.checkpoint.delete", SpanType.MEMORY, {"thread_id": thread_id}
        ) as operation:
            await self._delegate.adelete_thread(thread_id)
            operation.set_outputs({"deleted": True})

    def get_next_version(self, current, channel):
        return self._delegate.get_next_version(current, channel)


def set_lakebase_resources(
    checkpointer: AsyncCheckpointSaver, store: AsyncDatabricksStore
) -> None:
    global _lakebase_resources
    _lakebase_resources = (checkpointer, store)


@dataclass(frozen=True)
class LakebaseConfig:
    autoscaling_endpoint: Optional[str]
    autoscaling_project: Optional[str]
    autoscaling_branch: Optional[str]
    embedding_endpoint: str = "databricks-gte-large-en"  # override via DATABRICKS_EMBEDDING_ENDPOINT
    embedding_dims: int = 1024
    memory_schema: Optional[str] = None

    @property
    def description(self) -> str:
        return self.autoscaling_endpoint or f"{self.autoscaling_project}/{self.autoscaling_branch}"


def init_lakebase_config() -> LakebaseConfig:
    endpoint = os.getenv("LAKEBASE_AUTOSCALING_ENDPOINT") or None
    project = os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or None
    branch = os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or None

    has_autoscaling = project and branch
    if not endpoint and not has_autoscaling:
        raise ValueError(
            "Lakebase configuration is required but not set. "
            "Please set one of the following in your environment:\n"
            "  Option 1 (autoscaling endpoint): LAKEBASE_AUTOSCALING_ENDPOINT=<your-endpoint-name>\n"
            "  Option 2 (autoscaling): LAKEBASE_AUTOSCALING_PROJECT=<project> and LAKEBASE_AUTOSCALING_BRANCH=<branch>\n"
        )

    # Priority: endpoint > project+branch (mutually exclusive in the library)
    if endpoint:
        project = None
        branch = None
    else:
        endpoint = None

    embedding_endpoint = os.getenv("DATABRICKS_EMBEDDING_ENDPOINT", "databricks-gte-large-en")
    memory_schema = os.getenv("LAKEBASE_AGENT_MEMORY_SCHEMA") or None
    return LakebaseConfig(
        autoscaling_endpoint=endpoint,
        autoscaling_project=project,
        autoscaling_branch=branch,
        embedding_endpoint=embedding_endpoint,
        memory_schema=memory_schema,
    )


async def run_lakebase_setup(config: LakebaseConfig) -> None:
    """Run database migrations for checkpoint and store tables. Call once at app startup."""
    async with lakebase_context(config) as (checkpointer, store):
        await checkpointer.setup()
        await store.setup()
    logger.info("Lakebase setup complete")


def get_user_id(request: ResponsesAgentRequest) -> Optional[str]:
    custom_inputs = dict(request.custom_inputs or {})
    if "user_id" in custom_inputs:
        return custom_inputs["user_id"]
    if request.context and getattr(request.context, "user_id", None):
        return request.context.user_id
    return None


def get_lakebase_access_error_message(lakebase_description: str) -> str:
    """Generate a helpful error message for Lakebase access issues."""
    if _is_databricks_app_env():
        app_name = os.getenv("DATABRICKS_APP_NAME")
        return (
            f"Failed to connect to Lakebase '{lakebase_description}'. "
            f"The App Service Principal for '{app_name}' may not have access.\n\n"
            "To fix this:\n"
            "1. Go to the Databricks UI and navigate to your app\n"
            "2. Click 'Edit' → 'App resources' → 'Add resource'\n"
            "3. Add your Lakebase instance as a resource\n"
            "4. Grant the necessary permissions on your Lakebase instance. "
            "See the README section 'Grant Lakebase permissions to your App's Service Principal' for the SQL commands."
        )
    else:
        return (
            f"Failed to connect to Lakebase '{lakebase_description}'. "
            "Please verify:\n"
            "1. The endpoint (or project/branch) is correct\n"
            "2. You have the necessary permissions to access the instance\n"
            "3. Your Databricks authentication is configured correctly"
        )


@asynccontextmanager
async def lakebase_context(config: LakebaseConfig):
    """Yield (checkpointer, store) for short-term and long-term memory."""
    async with AsyncCheckpointSaver(
        autoscaling_endpoint=config.autoscaling_endpoint,
        project=config.autoscaling_project,
        branch=config.autoscaling_branch,
        schema=config.memory_schema,
    ) as checkpointer, AsyncDatabricksStore(
        autoscaling_endpoint=config.autoscaling_endpoint,
        project=config.autoscaling_project,
        branch=config.autoscaling_branch,
        embedding_endpoint=config.embedding_endpoint,
        embedding_dims=config.embedding_dims,
        schema=config.memory_schema,
    ) as store:
        yield checkpointer, store


@asynccontextmanager
async def acquire_lakebase_resources(config: LakebaseConfig):
    """Yield (checkpointer, store) for use in a request handler.

    If start_server.py's lifespan populated the long-lived resources, yield those
    without closing on exit. Otherwise (e.g. evaluate_agent.py running outside the
    FastAPI server) fall back to opening a fresh per-call lakebase_context.
    """
    if _lakebase_resources is not None:
        yield _lakebase_resources
    else:
        async with lakebase_context(config) as resources:
            yield resources


def memory_tools():
    @tool
    async def get_user_memory(query: str, config: RunnableConfig) -> str:
        """Search for relevant information about the user from long-term memory."""
        user_id = config.get("configurable", {}).get("user_id")
        if not user_id:
            return "Memory not available - no user_id provided."

        store: Optional[BaseStore] = config.get("configurable", {}).get("store")
        if not store:
            return "Memory not available - store not configured."

        namespace = ("user_memories", user_id.replace(".", "-"))
        async with traced_async_operation(
            "lakebase.memory.read",
            SpanType.MEMORY,
            {"namespace": namespace, "query": query, "limit": 5},
        ) as operation:
            results = await store.asearch(namespace, query=query, limit=5)
            operation.set_outputs(
                {"items": [{"key": item.key, "value": item.value} for item in results]}
            )

        if not results:
            return "No memories found for this user."

        memory_items = [f"- [{item.key}]: {json.dumps(item.value)}" for item in results]
        return f"Found {len(results)} relevant memories:\n" + "\n".join(memory_items)

    @tool
    async def save_user_memory(memory_key: str, memory_data_json: str, config: RunnableConfig) -> str:
        """Save information about the user to long-term memory."""
        user_id = config.get("configurable", {}).get("user_id")
        if not user_id:
            return "Cannot save memory - no user_id provided."

        store: Optional[BaseStore] = config.get("configurable", {}).get("store")
        if not store:
            return "Cannot save memory - store not configured."

        namespace = ("user_memories", user_id.replace(".", "-"))

        try:
            with traced_operation(
                "memory.json.parse",
                SpanType.PARSER,
                {"memory_data_json": memory_data_json},
            ) as parser:
                memory_data = json.loads(memory_data_json)
                parser.set_outputs({"memory_data": memory_data})
            if not isinstance(memory_data, dict):
                return f"Failed: memory_data must be a JSON object, not {type(memory_data).__name__}"
            async with traced_async_operation(
                "lakebase.memory.write",
                SpanType.MEMORY,
                {"namespace": namespace, "key": memory_key, "value": memory_data},
            ) as operation:
                await store.aput(namespace, memory_key, memory_data)
                operation.set_outputs({"saved": True, "key": memory_key})
            return f"Successfully saved memory '{memory_key}' for user."
        except json.JSONDecodeError as e:
            return f"Failed to save memory: Invalid JSON - {e}"

    @tool
    async def delete_user_memory(memory_key: str, config: RunnableConfig) -> str:
        """Delete a specific memory from the user's long-term memory."""
        user_id = config.get("configurable", {}).get("user_id")
        if not user_id:
            return "Cannot delete memory - no user_id provided."

        store: Optional[BaseStore] = config.get("configurable", {}).get("store")
        if not store:
            return "Cannot delete memory - store not configured."

        namespace = ("user_memories", user_id.replace(".", "-"))
        async with traced_async_operation(
            "lakebase.memory.delete",
            SpanType.MEMORY,
            {"namespace": namespace, "key": memory_key},
        ) as operation:
            await store.adelete(namespace, memory_key)
            operation.set_outputs({"deleted": True, "key": memory_key})
        return f"Successfully deleted memory '{memory_key}' for user."

    return [get_user_memory, save_user_memory, delete_user_memory]
