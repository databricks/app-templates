"""Liveness and readiness endpoints.

`/healthz` is a cheap liveness probe that does NOT touch Postgres.
`/api/health` is a readiness probe that round-trips to Lakebase.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config.database import get_async_db

router = APIRouter(tags=["health"])


class LivenessResponse(BaseModel):
    status: str = Field(..., examples=["alive"])


class ReadinessResponse(BaseModel):
    status: str = Field(..., examples=["ok", "degraded"])
    database: bool = Field(..., description="True if a SELECT 1 against Lakebase succeeded.")


@router.get(
    "/healthz",
    response_model=LivenessResponse,
    summary="Liveness probe (no DB)",
    description=(
        "Cheap liveness check. **Does NOT touch Postgres.** Returns immediately. "
        "Use this for orchestrator liveness probes where you only want to know "
        "whether the process is up."
    ),
)
async def healthz() -> LivenessResponse:
    return LivenessResponse(status="alive")


@router.get(
    "/api/health",
    response_model=ReadinessResponse,
    summary="Readiness probe (round-trips Postgres)",
    description=(
        "Readiness check that **does** round-trip to Lakebase via `SELECT 1`. "
        "Returns `database: true` on success, `database: false` (and "
        "`status: degraded`) on any DB error. Use this to confirm the app can "
        "actually reach the database, not just that the process is alive."
    ),
)
async def api_health(
    db: Annotated[AsyncSession, Depends(get_async_db)],
) -> ReadinessResponse:
    try:
        await db.execute(text("SELECT 1"))
        return ReadinessResponse(status="ok", database=True)
    except Exception:
        return ReadinessResponse(status="degraded", database=False)
