"""Centralized configuration via Pydantic BaseSettings.

Environment variables map directly to field names (case-insensitive).
Only TASK_TIMEOUT_SECONDS and POLL_INTERVAL_SECONDS are user-facing.
"""

from typing import Annotated

from pydantic import Field
from pydantic_settings import BaseSettings

PositiveSeconds = Annotated[float, Field(gt=0)]


class Settings(BaseSettings):
    # Agent configuration
    model: str = "databricks-claude-sonnet-4-6"
    system_prompt: str = (
        "You are a helpful assistant. You have access to Bash and custom MCP tools.\n\n"
        "## Long-Running Task\n"
        "When asked to run a long-running task or stress test, use the Bash tool to run "
        "this command which takes 2 minutes 30 seconds and logs progress every 30 seconds:\n"
        "```\n"
        'for i in 1 2 3 4 5; do sleep 30; msg="[$(($i*30))s / 150s] Step $i/5 complete ($(($i*20))%)"; '
        'echo "$msg"; echo "$msg" >&2; done; '
        'echo "Long-running task completed successfully after 2 minutes 30 seconds."\n'
        "```\n"
        "Report each progress line to the user as it arrives."
    )
    max_turns: int = 25
    ai_gateway_url: str = "https://2309167578215964.ai-gateway.cloud.databricks.com/anthropic"

    # Server configuration
    task_timeout_seconds: PositiveSeconds = 3600.0
    poll_interval_seconds: PositiveSeconds = 1.0
    log_level: str = "INFO"


settings = Settings()
