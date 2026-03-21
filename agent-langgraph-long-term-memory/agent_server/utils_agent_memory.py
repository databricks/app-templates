import logging
from io import BytesIO

from databricks.sdk import WorkspaceClient
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

MAX_INSTRUCTION_LINES = 50


def _volume_base_path(volume: str) -> str:
    return f"/Volumes/{volume.replace('.', '/')}"


def read_agent_instructions(w: WorkspaceClient, volume: str) -> str:
    """Read instructions.md from a UC Volume. Returns empty string if not found."""
    path = f"{_volume_base_path(volume)}/instructions.md"
    try:
        resp = w.files.download(path)
        return resp.contents.read().decode("utf-8")
    except Exception:
        return ""


def agent_memory_tools(workspace_client: WorkspaceClient, volume: str):
    @tool
    def save_agent_instruction(instruction: str, config: RunnableConfig) -> str:
        """Save a new instruction to the shared agent memory. Use for learnings that
        apply to ALL users: team preferences, process rules, best practices."""
        current = read_agent_instructions(workspace_client, volume)
        lines = [l for l in current.strip().split("\n") if l.strip()] if current.strip() else []
        if sum(1 for l in lines if l.startswith("- ")) >= MAX_INSTRUCTION_LINES:
            return f"Cannot save — already at {MAX_INSTRUCTION_LINES} instructions."
        lines.append(f"- {instruction}")
        path = f"{_volume_base_path(volume)}/instructions.md"
        workspace_client.files.upload(path, BytesIO(("\n".join(lines) + "\n").encode("utf-8")), overwrite=True)
        return f"Saved agent instruction: {instruction}"

    @tool
    def get_agent_instructions(config: RunnableConfig) -> str:
        """Read the current shared agent instructions."""
        content = read_agent_instructions(workspace_client, volume)
        return content if content.strip() else "No agent instructions saved yet."

    return [save_agent_instruction, get_agent_instructions]
