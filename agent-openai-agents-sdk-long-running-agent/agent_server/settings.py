"""Centralized configuration via Pydantic BaseSettings.

Environment variables map directly to field names (case-insensitive).
Only TASK_TIMEOUT_SECONDS and POLL_INTERVAL_SECONDS are user-facing;
the DB/cleanup knobs are internal safety defaults.
"""

from typing import Annotated

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings

PositiveSeconds = Annotated[float, Field(gt=0)]
PositiveMilliseconds = Annotated[int, Field(gt=0)]


class Settings(BaseSettings):
    task_timeout_seconds: PositiveSeconds = 1800.0
    poll_interval_seconds: PositiveSeconds = 1.0
    log_level: str = "INFO"

    # Internal safety knobs — not exposed in .env.example or databricks.yml.
    # db_statement_timeout_ms: Postgres forcefully kills queries exceeding this,
    # preventing orphaned row locks from cancelled asyncio tasks.
    # cleanup_timeout_seconds: how long the except-block waits for the DB cleanup
    # query after a task timeout. Must exceed db_statement_timeout_ms (in seconds)
    # so Postgres has time to release the ghost lock before cleanup executes.
    db_statement_timeout_ms: PositiveMilliseconds = 5000
    cleanup_timeout_seconds: PositiveSeconds = 7.0

    @model_validator(mode="after")
    def _cleanup_exceeds_db_timeout(self) -> "Settings":
        db_timeout_s = self.db_statement_timeout_ms / 1000.0
        if self.cleanup_timeout_seconds <= db_timeout_s:
            raise ValueError(
                f"cleanup_timeout_seconds ({self.cleanup_timeout_seconds}) must be "
                f"strictly greater than db_statement_timeout_ms converted to seconds "
                f"({db_timeout_s})"
            )
        return self


settings = Settings()
