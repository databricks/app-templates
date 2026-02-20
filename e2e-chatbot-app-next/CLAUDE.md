# Databricks E2E Chatbot Application - Context for Claude

## Project Overview

This is a production-ready, full-stack chatbot application built specifically for **Databricks environments**. It provides a web-based chat interface for interacting with Databricks Agent Serving endpoints, Agent Bricks, and Foundation Model endpoints.

**Key characteristics:**

- Monorepo architecture with npm workspaces
- Express.js backend + React frontend (Vite)
- PostgreSQL database with Drizzle ORM
- Vercel AI SDK for streaming responses
- Databricks-native authentication and deployment

## Architecture

### Monorepo Structure

```
e2e-chatbot-app-next/
├── client/                 # React + Vite frontend (@databricks/chatbot-client)
├── server/                 # Express backend (@databricks/chatbot-server)
└── packages/              # Shared libraries
    ├── core/              # Domain types, errors, schemas
    ├── auth/              # Authentication utilities
    ├── ai-sdk-providers/  # Databricks AI SDK integration
    ├── db/                # Database layer (Drizzle ORM)
    └── utils/             # Shared utilities
```

**IMPORTANT**: This is an npm workspaces monorepo. When adding dependencies:

- Root dependencies: For build tools, linting, testing
- Workspace dependencies: Add to the specific package (client, server, or packages/\*)
- Use `npm install <package> --workspace=<workspace-name>` for workspace-specific deps

### Key Technologies

**Frontend:**

- React 18.2 with TypeScript 5.6
- Vite 5.1 (build tool and dev server)
- Tailwind CSS 4.1 + Radix UI components
- React Router v6
- Vercel AI SDK (`@ai-sdk/react`) for streaming
- SWR for data fetching

**Backend:**

- Express 5.1 with TypeScript
- Vercel AI SDK (`ai` package) for streaming responses
- Zod for schema validation
- Header-based authentication (expects reverse proxy)

**Database:**

- PostgreSQL 16 (Databricks Lakebase)
- Drizzle ORM 0.44 with migrations
- Custom schema: `ai_chatbot`
- Tables: User, Chat, Message_v2 (Message is deprecated)

**Testing:**

- Playwright 1.50 for E2E tests
- MSW (Mock Service Worker) 2.11 for API mocking
- Test environment auto-detected via `PLAYWRIGHT=True`

**Code Quality:**

- Biome 1.9.4 for linting and formatting (NOT ESLint/Prettier)

## Essential Commands

### Quick Start Scripts

**For first-time setup and deployment:**

```bash
./scripts/quickstart.sh  # Interactive setup wizard (recommended for new users)
```

This automated script handles:
- Prerequisites installation (jq, nvm, Node 20, Databricks CLI)
- Configuration file setup (.env)
- Databricks authentication
- Serving endpoint configuration
- App/bundle name customization
- Database setup (optional, with conflict detection)
- Dependency installation
- Bundle deployment to Databricks
- Database migration (if enabled)
- Application startup

**IMPORTANT - For Claude Code**: Before running `quickstart.sh`, ask the user:

1. **"Do you have a Databricks serving endpoint ready?"**
   - If yes: Get the endpoint name
   - If no: Suggest they create one first or use the default `databricks-claude-sonnet-4`

2. **"Do you want to customize the app/bundle name?"**
   - Default will be `db-chatbot-dev-<username>`
   - Custom names must be ≤30 characters
   - Explain that names cannot be changed after first deployment

3. **"Do you want persistent chat history (requires a Lakebase database)?"**
   - Explain this takes 5-10 minutes on first deployment
   - Database costs apply (~$0.70/hour for CU_1)
   - Without database, chats are stored in memory (ephemeral mode)

4. **"Do you want to deploy to Databricks now, or just configure locally?"**
   - Deploy now: Script will run `databricks bundle deploy`
   - Configure only: User can deploy manually later

These questions help ensure the script runs smoothly and matches user expectations.

**For starting the local development server:**

```bash
./scripts/start-app.sh   # Simple script to install deps and run npm run dev
```

**For cleaning up database instances:**

```bash
./scripts/cleanup-database.sh  # Interactive database instance deletion
```

Use this when:
- You encounter "Instance name is not unique" deployment errors
- You want to start fresh with a new database
- You need to remove orphaned database instances

**Warning**: Database deletion is permanent and cannot be undone!

### Development

```bash
npm run dev              # Start both client (3000) and server (3001)
npm run dev:server       # Server only
npm run dev:client       # Client only
```

### Building

```bash
npm run build            # Full build: DB migrate → client → server
npm run build:client     # Build client only (outputs to client/dist/)
npm run build:server     # Build server only (outputs to server/dist/)
```

### Database Operations

```bash
npm run db:generate      # Generate SQL migration files from schema changes
npm run db:migrate       # Run pending SQL migrations (PRODUCTION-SAFE)
npm run db:reset         # Reset database (DESTRUCTIVE - deletes all data)
npm run db:studio        # Open Drizzle Studio (visual DB editor)
npm run db:push          # Push schema directly (DEVELOPMENT ONLY - can be destructive)
npm run db:pull          # Pull schema from database
npm run db:check         # Check migration consistency
```

**IMPORTANT Migration Workflow:**
1. Modify `packages/db/src/schema.ts`
2. Run `npm run db:generate` to create SQL migration file
3. Review the generated SQL in `packages/db/migrations/`
4. Run `npm run db:migrate` to apply migrations
5. Commit both `schema.ts` and migration files

**⚠️ DO NOT use `db:push` in production** - it bypasses migrations and can drop data!

### Code Quality

```bash
npm run lint             # Lint with Biome (auto-fix enabled)
npm run lint:fix         # Lint + format
npm run format           # Format only
```

### Testing

```bash
npm test                 # Run all Playwright tests (sets PLAYWRIGHT=True)
                         # Note: It can be helpful to start "export PLAYWRIGHT=True npm run dev" in parallel
                         # for shorter test loops if iterating over tests multiple times
npx playwright test --ui # Run tests in UI mode
npx playwright test --headed --project=e2e  # Run E2E tests with browser visible
```

**Test projects:** `unit`, `e2e`, `routes`
**Test timeout:** 240 seconds (very generous for AI operations)

### Deployment (Databricks Asset Bundle)

**IMPORTANT Pre-Deployment Checklist:**
1. **Check `databricks.yml` for TODOs** - When a user requests deployment, ALWAYS check `databricks.yml` for any TODO comments
2. **Prompt for missing values** - If TODOs exist (especially for `serving_endpoint_name`), ask the user to provide the required values before proceeding
3. **Update the file** - Set the default value in `databricks.yml` and remove the TODO comment

#### Enabling Database Integration (Optional)

By default, the app deploys in **ephemeral mode** - chats are stored in memory and lost on restart.

To enable **persistent chat history** with a managed Lakebase database, you need to uncomment **TWO sections** in `databricks.yml`:

1. Open `databricks.yml`

2. **Uncomment DATABASE RESOURCE (1)** - Find the database instance definition (around lines 17-21):
   ```yaml
   resources:
     database_instances:
     # DATABASE RESOURCE (1): Uncomment the database resource below...
     #   chatbot_lakebase:
     #     name: ${var.database_instance_name}-${var.resource_name_suffix}
     #     capacity: CU_1
   ```
   Remove the `#` symbols to uncomment it.

3. **Uncomment DATABASE RESOURCE (2)** - Find the database resource binding (around lines 39-44):
   ```yaml
   # DATABASE RESOURCE (2): uncomment the database resource below...
   # - name: database
   #   description: "Lakebase database instance for the chat app"
   #   database:
   #     database_name: databricks_postgres
   #     instance_name: ${resources.database_instances.chatbot_lakebase.name}
   #     permission: CAN_CONNECT_AND_CREATE
   ```
   Remove the `#` symbols to uncomment it.

4. Deploy as normal

**Important:** Both sections must be uncommented for database integration to work. The first creates the database instance, the second connects it to your app.

```bash
databricks bundle validate             # Validate bundle config
databricks bundle deploy               # Deploy to dev (default)
databricks bundle deploy -t staging    # Deploy to staging
databricks bundle run databricks_chatbot  # Start the app
databricks bundle summary              # View deployment status
```

## Code Style Guidelines

### Formatting Rules (Biome)

**IMPORTANT**: This project uses Biome, NOT ESLint or Prettier. All formatting is handled by Biome.

- **Indentation**: 2 spaces
- **Line width**: 80 characters
- **Quotes**: Single quotes for strings, double quotes for JSX attributes
- **Semicolons**: Always required
- **Trailing commas**: Always (all contexts)
- **Arrow parentheses**: Always include
- **Line endings**: LF (Unix)

### TypeScript Conventions

- **Strict mode**: Enabled
- **Target**: ES2022
- **Module**: ESNext with bundler resolution
- **Imports**: Use TypeScript path aliases for workspace packages:
  ```typescript
  import { something } from "@chat-template/core";
  import { auth } from "@chat-template/auth";
  import { db } from "@chat-template/db";
  ```

### Component Organization (React)

- Use functional components with hooks
- Organize components by feature/domain
- Place shared UI components in `client/src/components/ui/`
- Place app-specific components in `client/src/components/elements/`

### API Route Patterns (Express)

- All routes use Express Router
- Authentication middleware applied globally or per-route
- Error handling with `ChatSDKError` class
- Schema validation with Zod schemas
- Streaming responses use Vercel AI SDK utilities

Example route structure:

```typescript
export const myRouter: RouterType = Router();
myRouter.use(authMiddleware);
myRouter.post("/endpoint", requireAuth, async (req, res) => {
  // Implementation
});
```

## Database Patterns

### Schema Modifications

**ALWAYS follow this workflow when changing the database schema:**

1. Modify `packages/db/src/schema.ts`
2. Run `npm run db:generate` to create migration file
3. Review the generated SQL in `packages/db/migrations/`
4. Run `npm run db:migrate` to apply migrations
5. Commit both schema.ts and migration files

**Understanding Migration Commands:**

- **`npm run db:migrate`** - Runs SQL migration files from `packages/db/migrations/`
  - ✅ Safe for production
  - ✅ Maintains migration history
  - ✅ Idempotent (safe to run multiple times)
  - ✅ Will NOT drop unexpected schemas or tables

- **`npm run db:push`** - Syncs schema directly to database
  - ⚠️ Development/prototyping ONLY
  - ⚠️ Can drop tables/columns not in your schema
  - ⚠️ No migration history
  - ⚠️ NOT safe for production

**DO NOT** use `db:push` in production or with existing data!

### Querying Patterns

Use helper functions from `@chat-template/db`:

```typescript
import { getChatById, saveMessages, deleteChatById } from "@chat-template/db";
```

For custom queries, use Drizzle syntax with the exported schema:

```typescript
import { db, chat, message } from "@chat-template/db";
import { eq, and, desc } from "drizzle-orm";

const results = await db
  .select()
  .from(chat)
  .where(and(eq(chat.userId, userId), eq(chat.visibility, "private")))
  .orderBy(desc(chat.createdAt));
```

### Schema Location

**CRITICAL**: All tables are in the `ai_chatbot` schema, NOT the public schema.
This is configured in `packages/db/src/schema.ts:14` with `pgSchema('ai_chatbot')`.

### Drizzle Configuration

The Drizzle configuration is located at the **project root** in `drizzle.config.ts`. This configuration is automatically detected by all `drizzle-kit` commands (no need to specify `--config` flag).

## Authentication

### How It Works

This application uses **header-based authentication** (NOT cookies or tokens). It expects a reverse proxy or load balancer to inject user headers:

- `X-Forwarded-User` - User ID (required)
- `X-Forwarded-Email` - User email (optional)
- `X-Forwarded-Preferred-Username` - Display name (optional)

The auth middleware in `server/src/middleware/auth.ts` reads these headers and creates a session object:

```typescript
req.session = {
  user: { id, email, name },
};
```

### Auth Middleware Usage

- `authMiddleware` - Extracts session (doesn't reject)
- `requireAuth` - Returns 401 if no session
- `requireChatAccess` - Validates user owns the chat

### Local Development

When running locally (`npm run dev`), the application uses **Databricks CLI authentication**:

- Set `DATABRICKS_CONFIG_PROFILE` in `.env`
- Run `databricks auth login --profile <name>` first

## Environment Variables

### Required for Local Development

```bash
# Authentication
DATABRICKS_CONFIG_PROFILE=your-profile-name

# AI Model
DATABRICKS_SERVING_ENDPOINT=your-serving-endpoint

# Database (Individual variables preferred)
PGUSER=your-databricks-username
PGHOST=your-lakebase-host  # Use ./scripts/get-pghost.sh
PGDATABASE=databricks_postgres  # Default, usually don't change
PGPORT=5432  # Default
```

### Required for Production (Databricks Apps)

Automatically provided by the platform:

- `DATABRICKS_CLIENT_ID` - Service principal
- `DATABRICKS_CLIENT_SECRET` - Service principal secret
- `DATABRICKS_HOST` - Workspace URL
- `PGHOST`, `PGUSER`, etc. - From database resource binding

## Testing Practices

### Test Structure

```
tests/
├── e2e/              # Browser automation tests (Playwright)
├── routes/           # API endpoint tests
├── ai-sdk-provider/  # Unit tests for AI provider logic
├── api-mocking/      # MSW mock server setup
├── pages/            # Page object models
└── fixtures.ts       # Test fixtures (multi-user scenarios)
```

### Writing E2E Tests

Use page object pattern from `tests/pages/ChatPage.ts`:

```typescript
import { test } from "./fixtures";
import { ChatPage } from "./pages/ChatPage";

test("should send a message", async ({ page, adaContext }) => {
  const chatPage = new ChatPage(page);
  await chatPage.createNewChat();
  await chatPage.sendUserMessage("Hello");
  const response = await chatPage.getRecentAssistantMessage();
  expect(response).toBeTruthy();
});
```

### API Mocking

MSW automatically mocks Databricks API calls when `PLAYWRIGHT=True`:

- Mocks are defined in `tests/api-mocking/api-mock-server.ts`
- Server starts automatically in test environment
- Prevents external API calls during tests

### Multi-User Testing

Use fixtures for testing user isolation:

```typescript
test("users should see their own chats", async ({
  adaContext,
  babbageContext,
}) => {
  // adaContext and babbageContext are separate authenticated sessions
});
```

## Known Limitations & Quirks

### Database Schema Quirk

One database per app because code targets fixed `ai_chatbot` schema. To share a database instance:

1. Update `ai_chatbot` references in `packages/db/src/schema.ts`
2. Run `npm run db:generate`
3. Deploy with updated bundle

### Authentication Methods

Only Databricks CLI auth (local) and service principal auth (production) are supported. PAT, Azure MSI, etc. are NOT supported.

### Multi-Modal Inputs

No support for image or other multi-modal inputs currently.

## Common Tasks

### Adding a New API Endpoint

1. Create route file in `server/src/routes/my-route.ts`
2. Define router with auth middleware
3. Add schema validation with Zod
4. Export router and register in `server/src/index.ts`

### Adding a New Database Table

1. Add table definition to `packages/db/src/schema.ts`
2. Add TypeScript type: `export type MyTable = InferSelectModel<typeof myTable>;`
3. Run `npm run db:generate`
4. Review generated migration
5. Run `npm run db:migrate`
6. Add query helpers to `packages/db/src/queries.ts` if needed

### Adding a New React Component

1. Create in `client/src/components/` (ui/ or elements/)
2. Use TypeScript with proper prop types
3. Follow Tailwind CSS conventions
4. Export from component file

### Debugging AI Stream Responses

The app uses `StreamCache` (in `@chat-template/core`) to cache streaming responses. This prevents duplicate API calls on reconnection.

Streaming is handled by Vercel AI SDK:

```typescript
import { streamText, createUIMessageStream } from "ai";
```

Check `server/src/routes/chat.ts` for streaming implementation.

### Troubleshooting Bundle Deployment

**"reference does not exist" errors:**

- Update Databricks CLI: `brew upgrade databricks`

**"Resource not found" errors:**

- Check deployed resources: `databricks bundle summary`
- If resource was manually deleted: `databricks bundle unbind <resource-name>`
- If resource was manually created: See [DAB docs on binding](https://docs.databricks.com/aws/en/dev-tools/bundles/faqs)

## Deployment Architecture

### Databricks Asset Bundle Resources

The `databricks.yml` file defines:

1. **Lakebase Database Instance** - Managed PostgreSQL

   - Name: `chatbot-lakebase-{suffix}`
   - Capacity: CU_1 (customizable)

2. **Databricks App** - Hosted application
   - Name: `db-chatbot-{suffix}`
   - Resources:
     - Serving endpoint (with CAN_QUERY permission)
     - Database (with CAN_CONNECT_AND_CREATE permission)

### Deployment Targets

- **dev**: Default, user-scoped suffix (`dev-{username}`)
- **staging**: Shared staging environment
- **prod**: Production environment

### Multi-Agent Supervisor Note

If using Agent Bricks Multi-Agent Supervisor, you MUST grant the app service principal `CAN_QUERY` permission on ALL underlying agents. Add them as additional resources in `databricks.yml`:

```yaml
resources:
  - name: underlying-agent-1
    serving_endpoint:
      name: agent-1-endpoint
      permission: CAN_QUERY
```

## File Locations Reference

### Configuration Files

- `databricks.yml` - Databricks Asset Bundle config
- `app.yaml` - Databricks app runtime config (Node.js 20)
- `drizzle.config.ts` - Drizzle ORM and migration configuration
- `biome.jsonc` - Linting and formatting rules
- `playwright.config.ts` - Test configuration
- `tsconfig.json` - Root TypeScript config
- `.env.example` - Environment variable template
- `.env` - Local environment (gitignored)

### Important Code Paths

- `server/src/index.ts` - Express server entry point
- `server/src/routes/` - API route definitions
- `client/src/App.tsx` - React root component
- `packages/db/src/schema.ts` - Database schema
- `packages/db/src/queries.ts` - Database query helpers
- `packages/core/src/errors.ts` - Error definitions
- `packages/ai-sdk-providers/` - Databricks AI provider implementations
- `scripts/migrate.ts` - Database migration runner (applies SQL migrations from packages/db/migrations/)

### Convenience Scripts

- `scripts/quickstart.sh` - Interactive setup wizard for first-time deployment
  - Installs all prerequisites (jq, nvm, Node 20, Databricks CLI)
  - Configures authentication and environment variables
  - Handles app/bundle name customization with validation
  - Manages database setup with conflict detection
  - Deploys bundle and runs migrations
- `scripts/start-app.sh` - Simple local development server starter
  - Installs dependencies
  - Starts both frontend and backend with `npm run dev`
- `scripts/cleanup-database.sh` - Interactive database instance deletion tool
  - Lists all database instances in workspace
  - Provides safe deletion workflow with confirmations
  - Useful for resolving deployment conflicts

## Additional Resources

- [Databricks Agent Framework Docs](https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app)
- [Databricks Asset Bundles Tutorial](https://docs.databricks.com/aws/en/dev-tools/bundles/apps-tutorial)
- [Vercel AI SDK Docs](https://sdk.vercel.ai/docs)
- [Drizzle ORM Docs](https://orm.drizzle.team/docs/overview)
- [Playwright Docs](https://playwright.dev/)

## Repository Etiquette

- **Main branch**: `main`
- **Current branch**: `remove-nextjs` (feature branch)
- **Commit messages**: Concise, imperative mood
- **Testing**: Run `npm test` before committing
- **Linting**: Run `npm run lint` to auto-fix issues
- **Database changes**: Always generate migrations, never use db:push in production
- **Dependencies**: Add to appropriate workspace, not root (except for build tools)

---

**Note for Claude**: This file is automatically loaded as context. When working on this project, refer to these guidelines for commands, patterns, and conventions. Keep this file updated as the project evolves.
