"""Async PostgreSQL connection pool for Lakebase.

Uses AsyncLakebaseSQLAlchemy from databricks-ai-bridge for OAuth token handling:
- Tokens cached 15 minutes, refreshed on-demand when connections open
- pool_recycle=14 min ensures connections don't outlive token cache
- Engine created at startup, disposed at shutdown (on_event lifecycle)

When running in Databricks Apps, LAKEBASE_INSTANCE_NAME may be a hostname
(from valueFrom: "database") rather than an instance name. resolve_lakebase_instance_name
in agent_server.utils_lakebase resolves hostnames to instance names.
"""

import logging
import os
from contextlib import asynccontextmanager

from databricks_ai_bridge.lakebase import AsyncLakebaseSQLAlchemy
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from agent_server.db.models import AGENT_DB_SCHEMA, Base
from agent_server.settings import settings
from agent_server.utils_lakebase import resolve_lakebase_instance_name

logger = logging.getLogger(__name__)

_session_factory: async_sessionmaker[AsyncSession] | None = None
_engine = None
_lakebase: AsyncLakebaseSQLAlchemy | None = None


def is_db_configured() -> bool:
    """Check if database is configured (LAKEBASE_INSTANCE_NAME set)."""
    return bool(os.getenv("LAKEBASE_INSTANCE_NAME"))


async def init_db() -> None:
    """Create engine, schema, and tables. Call on app startup."""
    global _session_factory, _engine, _lakebase

    if not is_db_configured():
        logger.debug("[DB] Skipping: database not configured (LAKEBASE_INSTANCE_NAME not set)")
        return

    instance_name = os.getenv("LAKEBASE_INSTANCE_NAME")
    if not instance_name:
        raise ValueError("LAKEBASE_INSTANCE_NAME environment variable is required")

    instance_name = resolve_lakebase_instance_name(instance_name)

    _lakebase = AsyncLakebaseSQLAlchemy(
        instance_name=instance_name,
        pool_size=10,
        max_overflow=0,
        pool_pre_ping=True,
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
            raise RuntimeError("Database not configured (LAKEBASE_INSTANCE_NAME required)")
        async with _session_factory() as session:
            yield session

    return _session_cm()
