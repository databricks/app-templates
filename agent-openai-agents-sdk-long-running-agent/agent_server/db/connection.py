"""Async PostgreSQL connection pool for Lakebase.

Uses AsyncLakebaseSQLAlchemy from databricks-ai-bridge for OAuth token handling:
- Tokens cached 15 minutes, refreshed on-demand when connections open
- pool_recycle=14 min ensures connections don't outlive token cache
- Engine created at startup, disposed at shutdown (on_event lifecycle)

Supports two Lakebase modes:
- Provisioned: LAKEBASE_INSTANCE_NAME env var (may be a hostname from valueFrom: "database")
- Autoscaling: LAKEBASE_AUTOSCALING_PROJECT + LAKEBASE_AUTOSCALING_BRANCH env vars
"""

import logging
import os
from contextlib import asynccontextmanager

from databricks_ai_bridge.lakebase import AsyncLakebaseSQLAlchemy
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_server.db.models import AGENT_DB_SCHEMA, Base
from agent_server.settings import settings
from agent_server.db.utils_lakebase import resolve_lakebase_instance_name

logger = logging.getLogger(__name__)

_session_factory: async_sessionmaker[AsyncSession] | None = None
_engine = None
_lakebase: AsyncLakebaseSQLAlchemy | None = None


def is_db_configured() -> bool:
    """Check if database is configured (provisioned or autoscaling)."""
    has_provisioned = bool(os.getenv("LAKEBASE_INSTANCE_NAME"))
    has_autoscaling = bool(os.getenv("LAKEBASE_AUTOSCALING_PROJECT")) and bool(os.getenv("LAKEBASE_AUTOSCALING_BRANCH"))
    return has_provisioned or has_autoscaling


async def init_db() -> None:
    """Create engine, schema, and tables. Call on app startup."""
    global _session_factory, _engine, _lakebase

    if not is_db_configured():
        logger.debug("[DB] Skipping: database not configured (set LAKEBASE_INSTANCE_NAME or LAKEBASE_AUTOSCALING_PROJECT/BRANCH)")
        return

    instance_name = os.getenv("LAKEBASE_INSTANCE_NAME")
    autoscaling_project = os.getenv("LAKEBASE_AUTOSCALING_PROJECT") or None
    autoscaling_branch = os.getenv("LAKEBASE_AUTOSCALING_BRANCH") or None

    if instance_name:
        instance_name = resolve_lakebase_instance_name(instance_name)
        _lakebase = AsyncLakebaseSQLAlchemy(
            instance_name=instance_name,
            pool_size=10,
            max_overflow=0,
            pool_pre_ping=True,
        )
    elif autoscaling_project and autoscaling_branch:
        _lakebase = AsyncLakebaseSQLAlchemy(
            project=autoscaling_project,
            branch=autoscaling_branch,
            pool_size=10,
            max_overflow=0,
            pool_pre_ping=True,
        )
    else:
        raise ValueError(
            "Lakebase not configured. Set one of:\n"
            "  Option 1 (provisioned): LAKEBASE_INSTANCE_NAME=<your-instance-name>\n"
            "  Option 2 (autoscaling): LAKEBASE_AUTOSCALING_PROJECT=<project> and LAKEBASE_AUTOSCALING_BRANCH=<branch>"
        )
    _engine = _lakebase.engine

    # Force Postgres to kill any query exceeding db_statement_timeout_ms.
    # This is the only reliable way to reclaim a connection whose query is
    # stuck (e.g. waiting on a lock) — asyncio.timeout cannot interrupt
    # psycopg's C-level wait().  Uses "checkout" (not "connect") because
    # the pool resets session GUCs when returning connections; "connect"
    # only fires once per physical connection and gets wiped on reuse.
    # Applied via event listener because AsyncLakebaseSQLAlchemy already
    # sets its own connect_args (for sslmode), so we can't pass ours.
    @event.listens_for(_engine.sync_engine, "checkout")
    def _set_statement_timeout(dbapi_conn, connection_record, connection_proxy):
        cursor = dbapi_conn.cursor()
        cursor.execute(f"SET statement_timeout = {settings.db_statement_timeout_ms}")
        cursor.close()

    _session_factory = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    async with _engine.begin() as conn:
        await conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {AGENT_DB_SCHEMA}"))
        await conn.run_sync(Base.metadata.create_all)

    logger.info(
        "[DB] Engine and schema ready"
    )


async def dispose_db() -> None:
    """Dispose engine and clear registration. Call on app shutdown."""
    global _session_factory, _engine, _lakebase

    if _engine is not None:
        await _engine.dispose()
        logger.info("[DB] Engine disposed")
    _session_factory = None
    _engine = None
    _lakebase = None


def get_async_session():
    """Return an async context manager yielding a session from the pool."""
    @asynccontextmanager
    async def _session_cm():
        if _session_factory is None:
            raise RuntimeError("Database not configured (set LAKEBASE_INSTANCE_NAME or LAKEBASE_AUTOSCALING_PROJECT/BRANCH)")
        async with _session_factory() as session:
            yield session

    return _session_cm()
