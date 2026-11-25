"""The app's entry point: `uvicorn app:app`. This file is yours.

The template's review queue routes, /setup page and client come from `review_queue/`. Add your own
routes in `create_app` (see "Build your own review flow" in the README).
"""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from review_queue import ReviewQueue
from security import SecurityMiddleware


def create_app(review_queue: ReviewQueue | None = None) -> FastAPI:
    # Swagger UI and ReDoc rely on inline scripts that the CSP blocks.
    app = FastAPI(title="MLflow Review App", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(SecurityMiddleware)

    # Queues, items and answers for your UI, with the reviewer access checks. Template-owned.
    (review_queue or ReviewQueue()).mount(app)

    # Add your own routes here, before the static files.

    # Serves your UI from static/ (static/index.html is the entry page). Keep this last.
    app.mount("/", StaticFiles(directory="static", html=True), name="static")
    return app


app = create_app()
