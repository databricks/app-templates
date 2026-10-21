# Backend Patterns

## Technology Stack

- **Framework:** FastAPI + Pydantic
- **Package manager:** uv (never pip)
- **Database ORM:** SQLModel (requires lakebase addon)
- **Auth:** Databricks WorkspaceClient (service principal or OBO)

## 3-Model Pattern

Every API entity uses three Pydantic models:

| Model       | Purpose                 | Example   |
| ----------- | ----------------------- | --------- |
| `Entity`    | Internal/database model | `Item`    |
| `EntityIn`  | Input/request body      | `ItemIn`  |
| `EntityOut` | Output/response model   | `ItemOut` |

```python
from pydantic import BaseModel

# Internal/DB model
class Item(BaseModel):
    id: str
    name: str
    description: str | None = None
    created_at: datetime

# Input model — only fields the client sends
class ItemIn(BaseModel):
    name: str
    description: str | None = None

# Output model — what the API returns
class ItemOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    created_at: datetime
```

## CRUD Router Template

API routes **must** include `response_model` and `operation_id` for correct client generation.

The `operation_id` maps directly to the generated TypeScript hook name:

- `operation_id="listItems"` → `useListItems()` / `useListItemsSuspense()`
- `operation_id="createItem"` → `useCreateItem()`
- `operation_id="getItem"` → `useGetItem()` / `useGetItemSuspense()`
- `operation_id="updateItem"` → `useUpdateItem()`
- `operation_id="deleteItem"` → `useDeleteItem()`

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api")

@router.get("/items", response_model=list[ItemOut], operation_id="listItems")
async def list_items(page: int = 1, page_size: int = 20):
    ...

@router.post("/items", response_model=ItemOut, operation_id="createItem")
async def create_item(item: ItemIn):
    ...

@router.get("/items/{item_id}", response_model=ItemOut, operation_id="getItem")
async def get_item(item_id: str):
    ...

@router.put("/items/{item_id}", response_model=ItemOut, operation_id="updateItem")
async def update_item(item_id: str, item: ItemIn):
    ...

@router.delete("/items/{item_id}", operation_id="deleteItem")
async def delete_item(item_id: str):
    ...
```

## SDK Listing with Pagination

Databricks SDK listing methods (`ws.jobs.list()`, `ws.clusters.list()`, etc.) return **lazy iterators** that handle pagination internally. To expose paginated REST endpoints, collect items into a page-sized slice on the backend.

### Paginated Response Model

```python
from pydantic import BaseModel

class PaginatedResponse[T](BaseModel):
    """Generic paginated response wrapper."""
    items: list[T]
    next_page_token: str | None = None
```

### Paginated SDK List Endpoint

```python
from itertools import islice
from databricks.sdk.service.jobs import BaseJob
from .core import Dependencies, create_router
from .models import PaginatedResponse

router = create_router()

@router.get(
    "/jobs",
    response_model=PaginatedResponse[BaseJob],
    operation_id="listJobs",
)
def list_jobs(
    ws: Dependencies.Client,
    page_size: int = 20,
    page_token: str | None = None,
):
    """List jobs with cursor-based pagination wrapping the SDK iterator."""
    iterator = ws.jobs.list()

    # If resuming from a cursor, skip past it
    if page_token:
        for job in iterator:
            if str(job.job_id) == page_token:
                break

    items = list(islice(iterator, page_size))
    next_token = str(items[-1].job_id) if len(items) == page_size else None
    return PaginatedResponse(items=items, next_page_token=next_token)
```

### Key Rules

- **Always use SDK methods** (`ws.jobs.list()`, `ws.clusters.list()`) — never call the REST API directly via `requests`, `httpx`, or `ws.api_client.do()`.
- SDK listing methods return **iterators** that auto-paginate. You do not need to pass `page_token` to the SDK — only to your own FastAPI endpoint.
- Use `itertools.islice` to take a page of results from the SDK iterator.
- The `page_token` is an opaque cursor the frontend passes back. Use an item's unique ID (e.g. `job_id`).
- **SDK dataclasses are Pydantic-compatible** — use them directly in `response_model` (e.g. `PaginatedResponse[BaseJob]`) or compose them into custom models:
  ```python
  class MyResponse(BaseModel):
      payload: BaseJob
  ```
- Use the `docs` MCP tool to look up the exact SDK method signature before writing code.

## SSE Streaming Endpoint

For chat, agent, or real-time features, use Server-Sent Events (SSE) with FastAPI's `StreamingResponse`.

### Streaming Response Model

```python
from fastapi.responses import StreamingResponse

@router.post("/chat", operation_id="chat")
async def chat(
    request: ChatRequest,
    ws: Dependencies.Client,
) -> StreamingResponse:
    """Stream chat responses as Server-Sent Events."""

    async def event_stream():
        # Replace with your LLM/agent streaming call
        async for chunk in my_agent.run_stream(request.message):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

### Key Rules

- Use `StreamingResponse` with `media_type="text/event-stream"` — not a regular JSON response.
- Each SSE event must be formatted as `data: <payload>\n\n` (double newline).
- Send `data: [DONE]\n\n` as the final event to signal stream completion.
- Set `Cache-Control: no-cache` and `X-Accel-Buffering: no` headers to prevent buffering.
- SSE endpoints use `POST` (not `GET`) when they accept a request body.
- Generated React Query hooks **do not work** for SSE — the frontend must use manual `fetch()` + `ReadableStream` (see [Frontend Patterns](frontend-patterns.md#sse-streaming-chatagent)).
- Always include `operation_id` for OpenAPI documentation even though the generated hook won't be used for streaming.

## Dependencies and Dependency Injection

The `Dependencies` class in `src/<app>/backend/core.py` provides typed FastAPI dependencies. **Always use these instead of manually creating clients or accessing `request.app.state`.**

| Dependency              | Type              | Description                                                                        |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `Dependencies.Client`     | `WorkspaceClient` | Databricks client using app-level service principal credentials                    |
| `Dependencies.UserClient` | `WorkspaceClient` | Databricks client authenticated on behalf of the current user (requires OBO token) |
| `Dependencies.Config`     | `AppConfig`       | Application configuration loaded from environment variables                        |
| `Dependencies.Session`    | `Session`         | SQLModel database session, scoped to request (requires lakebase addon)             |

### Usage in Route Handlers

```python
from .core import Dependencies, create_router

router = create_router()

# Service principal client
@router.get("/clusters", response_model=list[ClusterOut], operation_id="listClusters")
def list_clusters(ws: Dependencies.Client):
    return ws.clusters.list()

# User-scoped client (OBO)
@router.get("/me", response_model=UserOut, operation_id="currentUser")
def me(user_ws: Dependencies.UserClient):
    return user_ws.current_user.me()

# Application config
@router.get("/settings", response_model=AppSettingsOut, operation_id="getSettings")
def get_settings(config: Dependencies.Config):
    return AppSettingsOut(app_name=config.app_name)

# Database session (requires lakebase addon)
@router.get("/orders", response_model=list[OrderOut], operation_id="getOrders")
def get_orders(session: Dependencies.Session):
    return session.exec(select(Order)).all()
```

## Extending AppConfig

Add custom fields to `AppConfig` in `core.py`. Fields are populated from environment variables with `{APP_SLUG}_` prefix:

```python
class AppConfig(BaseSettings):
    app_name: str = Field(default=app_name)
    my_setting: str = Field(default="value")  # env var: {APP_SLUG}_MY_SETTING
```

## Custom Lifespan

Use the `lifespan` parameter in `create_app` for startup/shutdown logic. The default lifespan (config + workspace client) runs first:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def custom_lifespan(app: FastAPI):
    # app.state.config and app.state.workspace_client already available
    app.state.my_resource = await init_something(app.state.config)
    yield

app = create_app(routers=[router], lifespan=custom_lifespan)
```

## Project Layout

```
src/<app>/backend/
├── app.py             # FastAPI entrypoint: app = create_app(routers=[router], lifespan=...)
├── router.py          # API routes with operation_id
├── models.py          # Pydantic models (Entity, EntityIn, EntityOut)
└── core.py            # Dependency class, AppConfig, create_router, create_app
```

Backend serves the frontend at `/` and the API at `/api`.
