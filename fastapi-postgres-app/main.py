"""FastAPI app entrypoint.

Pattern from https://apps-cookbook.dev/docs/fastapi/getting_started/lakebase_connection,
adapted for Lakebase Autoscale. See config/database.py for the auth flow.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from config.database import init_engine, start_token_refresh, stop_token_refresh
from routes import health

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_engine()
    await start_token_refresh()
    logger.info("App started with Lakebase connection")
    yield
    await stop_token_refresh()
    logger.info("App shutdown complete")


app = FastAPI(
    title="Lakebase FastAPI Example",
    description="Minimal FastAPI app connecting to Lakebase Autoscale with async SQLAlchemy.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(health.router)


@app.get("/")
async def root():
    return {"message": "Lakebase FastAPI example. See /docs for the OpenAPI UI."}
