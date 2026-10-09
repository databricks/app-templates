---
name: apx
description: Quick reference for building full-stack Databricks Apps with apx (React + FastAPI). Use when working on apx projects, creating routes, adding components, or managing dev servers.
user-invocable: true
---

# apx Toolkit

apx is the toolkit for building full-stack Databricks Apps with React + FastAPI.

## Prerequisites

Before using apx, verify the CLI is installed:

```bash
apx --version
```

If not installed:

- **macOS/Linux:** `curl -fsSL https://databricks-solutions.github.io/apx/install.sh | sh`
- **Windows (PowerShell):** `irm https://databricks-solutions.github.io/apx/install.ps1 | iex`

## When to Use This Skill

- Working on a project that uses apx (check for `pyproject.toml` with apx entrypoint or `databricks.yml`)
- Creating or modifying FastAPI routes, Pydantic models, or React pages
- Managing dev servers, checking errors, or viewing logs
- Adding shadcn/ui components or frontend dependencies
- Deploying or debugging Databricks Apps

## Quick Start

The project follows standard apx conventions. Use MCP tools and pattern files instead of exploring the codebase:

1. **`routes`** — Call this first to see all API routes. Do NOT read source files to explore.
2. **`docs`** — Search SDK docs for the method you need (e.g. "jobs list") before writing any `ws.*` call.
3. **Follow patterns** — See [backend-patterns.md](backend-patterns.md) for models, routers, pagination, and DI.
4. **`refresh_openapi`** — Run after adding/modifying backend routes so frontend hooks update automatically.
5. **`check`** — Run type checks to verify correctness after changes.

## Project Structure

```
src/<app>/
├── ui/                    # React + Vite frontend
│   ├── components/        # UI components (shadcn/ui)
│   ├── routes/            # @tanstack/react-router pages
│   ├── lib/               # Utilities (api client, selector)
│   └── styles/            # CSS styles
└── backend/               # FastAPI backend
    ├── app.py             # Main FastAPI app
    ├── router.py          # API routes
    ├── models.py          # Pydantic models
    └── core.py            # Config, logging, Dependency class, bootstrap
```

## CLI Commands

| Command                     | Description                                                  |
| --------------------------- | ------------------------------------------------------------ |
| `apx dev start`             | Start all dev servers (backend + frontend + OpenAPI watcher) |
| `apx dev stop`              | Stop all dev servers                                         |
| `apx dev status`            | Check status of running servers                              |
| `apx dev check`             | Check for TypeScript/Python errors                           |
| `apx dev logs`              | View recent logs (default: last 10m)                         |
| `apx dev logs -f`           | Follow/stream logs in real-time                              |
| `apx build`                 | Build for production                                         |
| `apx bun <args>`            | Run bun commands (install, add, etc.)                        |
| `apx components add <name>` | Add a shadcn/ui component                                    |
| `apx init --as-member`      | Add apx to an existing project as a uv workspace member      |
| `apx dev apply <addon>`     | Apply an addon to an existing project                        |

## Addons

Addons extend the base project with additional capabilities (UI, assistant rules, database integrations, etc.).
To list available addons, run `apx dev apply --help`.
To apply an addon to an existing project: `apx dev apply <addon>` (e.g. `apx dev apply lakebase`).
During `apx init`, addons are selected interactively or via `--addons=ui,claude,sidebar`.

## Adding to an Existing Project

Use `--as-member` to add apx into an existing Python project or monorepo as a uv workspace member:

```bash
# Recommended: explicit member path
apx init --as-member=packages/app

# Or just auto-detect (when pyproject.toml exists without [tool.apx])
apx init
```

Auto-detected: running `apx init` in a directory with an existing `pyproject.toml` (without `[tool.apx]`) automatically uses member mode with default path `packages/app`.

The command:

- Creates app files in the member subdirectory (e.g. `packages/app`)
- Configures `[tool.uv.workspace]` in the root `pyproject.toml`
- Initializes git at the workspace root if needed

## MCP Tools

When the apx MCP server is running, these tools are available:

| Tool                         | Description                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`                      | Start the development server and return its URL. Call before testing UI or API changes.                                                                                                                                                                         |
| `stop`                       | Stop the development server.                                                                                                                                                                                                                                    |
| `restart`                    | Restart the development server (preserves port). Use after backend code changes.                                                                                                                                                                                |
| `logs`                       | Fetch recent dev server logs. Use to diagnose runtime errors or startup issues.                                                                                                                                                                                 |
| `check`                      | Run TypeScript and Python type checks in parallel. Returns categorized errors. Call after making changes to verify correctness.                                                                                                                                 |
| `routes`                     | List all API routes with their parameters, request/response schemas, and generated hook names. Call this first to understand the project's API surface before reading source files.                                                                             |
| `get_route_info`             | Get a complete frontend code example for a specific API route, including Suspense/ErrorBoundary scaffold and correct hook usage with parameters. Call this before writing any frontend code that uses an API route. Pass the operation_id from the routes tool. |
| `refresh_openapi`            | Regenerate the OpenAPI schema and TypeScript API client from backend routes. Run after adding or modifying backend routes.                                                                                                                                      |
| `search_registry_components` | Semantic search for UI components across configured registries (shadcn, etc). Returns component IDs usable with add_component.                                                                                                                                  |
| `add_component`              | Install a UI component into the project. Accepts 'component-name' (default registry) or '@registry-name/component-name'.                                                                                                                                        |
| `list_registry_components`   | List all available components in a registry. Defaults to shadcn registry if none specified.                                                                                                                                                                     |
| `docs`                       | Search Databricks SDK documentation for Python code examples and API references. Always call this before writing any Databricks SDK (ws.\*) call to verify the correct method signature.                                                                        |
| `databricks_apps_logs`       | Fetch logs from a deployed Databricks App using the Databricks CLI. Use for debugging deployed (not local dev) issues.                                                                                                                                          |
| `feedback_prepare`           | Prepare a feedback issue for review. Returns the formatted title, body, and a browser URL. Call `feedback_submit` to create the GitHub issue.                                                                                                                   |
| `feedback_submit`            | Submit a prepared feedback issue as a public GitHub issue. Pass the exact title and body returned by `feedback_prepare`.                                                                                                                                        |

## Recommended Workflow

1. **routes** — List all API routes to understand the project's API surface
2. **get_route_info** — Get a complete code example for a specific route
3. **search_registry_components** / **add_component** — Find and install UI components
4. **refresh_openapi** — Regenerate the API client after backend route changes
5. **check** — Run type checks to verify correctness
6. **start** / **restart** — Start or restart the dev server to test changes
7. **logs** — Diagnose runtime errors if something goes wrong

## Do's and Don'ts

- OpenAPI client auto-regenerates on code changes when dev servers are running — don't manually regenerate.
- Prefer running apx related commands via MCP server if it's available.
- Use the apx MCP `search_registry_components` and `add_component` tools to find and add shadcn/ui components.
- When using the API calls on the frontend, use error boundaries to handle errors.
- Run `apx dev check` command (via CLI or MCP) to check for errors in the project code after making changes.
- If agent has access to native browser tool, use it to verify changes on the frontend. If such tool is not present or is not working, use playwright MCP to automate browser actions.

### Databricks SDK

- **SDK first:** Always use `databricks-sdk` (`WorkspaceClient`) methods for Databricks operations. Never use raw `requests`/`httpx` calls or `ws.api_client.do()` to call Databricks REST APIs.
- **Verify signatures:** Call the `docs` MCP tool before writing any `ws.*` call to confirm the exact method name, parameters, and return type.
- SDK listing methods (e.g. `ws.jobs.list()`, `ws.clusters.list()`) return **lazy iterators** that auto-paginate — do NOT manually manage API pagination tokens when calling SDK methods.
- **SDK dataclasses are Pydantic-compatible** — use them directly in `response_model` or compose into custom models: `class MyResponse(BaseModel): payload: SdkDataclass`.
- Inject the WorkspaceClient via `Dependencies.Client` (service principal) or `Dependencies.UserClient` (OBO) — never construct it manually.
- For paginated list endpoints, see [Backend Patterns — SDK Listing with Pagination](backend-patterns.md#sdk-listing-with-pagination).

### Package Management

- **Frontend:** Use `apx bun install` or `apx bun add <dependency>` for frontend package management.
- **Python:** Always use `uv` (never `pip`).

### Component Management

- **Check configured registries first:** Before creating custom components, check `[tool.apx.ui.registries]` in `pyproject.toml` for domain-specific registries (e.g. `@ai-elements` for chat/AI components, `@animate-ui` for animations). Use `list_registry_components` with the registry name to browse all available components.
- **Finding components:** Use MCP `search_registry_components` to search across all registries. Results from project-configured registries are boosted in scoring.
- **Adding components:** Use MCP `add_component` or CLI `apx components add <component> --yes`. For custom registries: `@registry-name/component-name`.
- **Component location:** If a component was added to a wrong location (e.g. `src/components/` instead of `src/<app>/ui/components/`), move it to the proper folder.
- **Component organization:** Group components by functionality (e.g. `src/<app>/ui/components/chat/`).

## Reference Files

For detailed patterns and code examples, see:

- [Backend Patterns](backend-patterns.md) — DI, 3-model pattern, CRUD routers, lifespan, AppConfig
- [Frontend Patterns](frontend-patterns.md) — Suspense, mutations, selector, component conventions

## Resources

- OpenAPI client: `src/<app>/ui/lib/api.ts` (auto-generated).
  Example:
  ```ts
  import { api } from "@/lib/api";
  ```
- Selector: `src/<app>/ui/lib/selector.ts`
  Example:
  ```ts
  import { selector } from "@/lib/selector";
  ```
- Routes: `src/<app>/ui/routes/`
- Components: `src/<app>/ui/components/`
- Backend: `src/<app>/backend/`
