"""Lakebase Autoscale connection helper for a FastAPI app.

Based on the Databricks Apps Cookbook recipe at
https://apps-cookbook.dev/docs/fastapi/getting_started/lakebase_connection,
adapted for Lakebase Autoscale (endpoint-based credential generation via
`w.postgres.generate_database_credential(endpoint=...)`).

Connection details come from the platform-injected env vars that Databricks
Apps populates when a Lakebase resource is bound to the app:

  PGHOST        Lakebase endpoint host
  PGPORT        Postgres port (5432)
  PGDATABASE    Database name
  PGUSER        App service principal's client ID (also the PG role name)
  PGSSLMODE     `require`
  PGAPPNAME     The app name

For the OAuth token we also need the endpoint *resource name*, which is NOT
auto-injected — set it in app.yaml via `valueFrom: <resource-key>`:

  PGENDPOINT   projects/<project>/branches/<branch>/endpoints/<endpoint>

See https://docs.databricks.com/aws/en/dev-tools/databricks-apps/lakebase
for the auto-injected variable list.
"""
import asyncio
import logging
import os
import time
from typing import AsyncGenerator

from databricks.sdk import WorkspaceClient
from dotenv import load_dotenv
from sqlalchemy import URL, event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()
logger = logging.getLogger(__name__)

# Module-level state. Initialized at FastAPI startup via init_engine().
engine: AsyncEngine | None = None
AsyncSessionLocal: sessionmaker | None = None
workspace_client: WorkspaceClient | None = None

# Current Lakebase OAuth token. Rotated by the background task every 50 min;
# the SQLAlchemy event listener reads this on every new connection.
postgres_password: str | None = None
last_password_refresh: float = 0.0
token_refresh_task: asyncio.Task | None = None


def _endpoint() -> str:
    val = os.getenv("PGENDPOINT")
    if not val:
        raise RuntimeError(
            "PGENDPOINT is required. Bind a Lakebase resource to the app "
            "and reference it via `valueFrom: <resource-key>` in app.yaml. "
            "Format: projects/<project>/branches/<branch>/endpoints/<endpoint>."
        )
    return val


def _mint_token() -> str:
    """Generate a fresh OAuth token for the Lakebase endpoint."""
    assert workspace_client is not None, "WorkspaceClient not initialized"
    cred = workspace_client.postgres.generate_database_credential(endpoint=_endpoint())
    if not cred.token:
        raise RuntimeError("generate_database_credential returned no token")
    return cred.token


async def refresh_token_background():
    """Refresh the Lakebase OAuth token every 50 minutes.

    Tokens are valid ~60 min; refreshing at 50 gives a 10-min safety margin.
    The new token is stored in module-global `postgres_password`; the
    SQLAlchemy event listener reads it for each new connection.
    """
    global postgres_password, last_password_refresh
    while True:
        try:
            await asyncio.sleep(50 * 60)
            logger.info("Refreshing Lakebase OAuth token")
            postgres_password = _mint_token()
            last_password_refresh = time.time()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Background token refresh failed: %s", e)


def init_engine() -> None:
    """Initialize the async SQLAlchemy engine with Lakebase Autoscale auth."""
    global engine, AsyncSessionLocal, workspace_client, postgres_password, last_password_refresh

    workspace_client = WorkspaceClient()

    # Auto-injected by the Apps platform when a Lakebase resource is bound.
    host = os.environ.get("PGHOST")
    database = os.environ.get("PGDATABASE")
    port = int(os.environ.get("PGPORT", "5432"))
    user = os.environ.get("PGUSER") or workspace_client.current_user.me().user_name
    sslmode = os.environ.get("PGSSLMODE", "require")

    if not host or not database:
        raise RuntimeError(
            "PGHOST and PGDATABASE are required. They're auto-injected when a "
            "Lakebase resource is bound to the app (per "
            "docs.databricks.com/aws/en/dev-tools/databricks-apps/lakebase). "
            "For local dev, set them in .env (see .env.example)."
        )

    # Initial token.
    postgres_password = _mint_token()
    last_password_refresh = time.time()
    logger.info("Initial Lakebase token minted; user=%s host=%s db=%s", user, host, database)

    url = URL.create(
        drivername="postgresql+asyncpg",
        username=user,
        password="",  # injected by event listener below
        host=host,
        port=port,
        database=database,
    )

    # asyncpg uses `ssl` not `sslmode` in connect_args. Map common PG values.
    ssl_arg = "require" if sslmode.lower() in ("require", "verify-ca", "verify-full") else False

    engine = create_async_engine(
        url,
        pool_pre_ping=False,
        echo=False,
        pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "10")),
        pool_timeout=int(os.getenv("DB_POOL_TIMEOUT", "10")),
        pool_recycle=int(os.getenv("DB_POOL_RECYCLE_INTERVAL", "3600")),
        connect_args={
            "command_timeout": int(os.getenv("DB_COMMAND_TIMEOUT", "30")),
            "server_settings": {
                "application_name": os.environ.get("PGAPPNAME", "lakebase_fastapi_example"),
            },
            "ssl": ssl_arg,
        },
    )

    @event.listens_for(engine.sync_engine, "do_connect")
    def provide_token(dialect, conn_rec, cargs, cparams):
        cparams["password"] = postgres_password

    AsyncSessionLocal = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    logger.info("Database engine initialized")


async def start_token_refresh() -> None:
    global token_refresh_task
    if token_refresh_task is None or token_refresh_task.done():
        token_refresh_task = asyncio.create_task(refresh_token_background())
        logger.info("Background token refresh task started")


async def stop_token_refresh() -> None:
    global token_refresh_task
    if token_refresh_task and not token_refresh_task.done():
        token_refresh_task.cancel()
        try:
            await token_refresh_task
        except asyncio.CancelledError:
            pass
        logger.info("Background token refresh task stopped")


async def get_async_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency for getting an async DB session per request.

    Inject into endpoints with:
        db: Annotated[AsyncSession, Depends(get_async_db)]
    """
    if AsyncSessionLocal is None:
        raise RuntimeError("Engine not initialized; call init_engine() first")
    async with AsyncSessionLocal() as session:
        yield session
