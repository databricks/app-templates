# Databricks E2E Chatbot App - Claude Code Guide

## Project Overview

**Name:** Databricks E2E Chatbot App (Next.js)
**Version:** 3.1.0
**Type:** Full-stack AI chatbot application

This is a production-ready chat interface template for interacting with **Databricks Agent Serving endpoints** and **Agent Bricks** (custom code agents). The application is tightly integrated with Databricks infrastructure for authentication, model serving, and data persistence.

**Key Characteristics:**
- Databricks-native authentication (OAuth + CLI auth)
- Chat history persisted in Databricks Lakebase (PostgreSQL)
- Multi-tenant with user-scoped conversations
- Stream resumption for network resilience
- Deployed as a Databricks App Bundle

**Based on:** Vercel AI Chatbot template with Databricks-specific enhancements

---

## Architecture & Tech Stack

### Core Framework
- **Next.js:** v15.4.4 (App Router, React 18)
- **TypeScript:** v5.6.3 (strict mode enabled)
- **Node.js:** Runtime with async/await patterns

### AI/ML Stack
- **Vercel AI SDK:** v5.0.26 (streaming LLM responses)
- **@ai-sdk/react:** v2.0.26 (useChat hook)
- **Custom Databricks Provider:** For FMAPI, Chat Agents, and Response Agents
- **Tool Calling:** Custom Databricks tool call handling

### Database
- **Drizzle ORM:** v0.34.0 (TypeScript-first ORM)
- **PostgreSQL:** Via Databricks Lakebase
- **postgres-js:** v3.4.4 (PostgreSQL client)
- **Schema:** `ai_chatbot` (fixed schema name)

### Authentication
- **Databricks OAuth:** Service Principal for deployed apps
- **Databricks CLI Auth:** User-to-Machine OAuth for local dev
- **SCIM API:** For user information retrieval

### UI/Styling
- **Tailwind CSS:** v4.1.13 (utility-first CSS)
- **Radix UI:** v1.x (accessible component primitives)
- **Framer Motion:** v11.3.19 (animations)
- **Lucide React:** v0.446.0 (icons)
- **next-themes:** v0.3.0 (dark/light mode)

### Content Rendering
- **React Markdown:** v10.1.0
- **Streamdown:** v1.2.0 (streaming markdown with custom renderers)
- **Shiki:** v3.12.2 (syntax highlighting)
- **Remark/Rehype plugins:** GFM, math (KaTeX), code highlighting

### Development Tools
- **Biome:** v1.9.4 (linting and formatting - NOT ESLint/Prettier)
- **Playwright:** v1.50.1 (E2E testing)
- **MSW:** v2.11.5 (API mocking)
- **Zod:** v3.25.76 (schema validation)

### Data Fetching
- **SWR:** v2.2.5 (client-side caching and pagination)

---

## Folder Structure

```
/
├── app/                              # Next.js App Router
│   ├── (chat)/                       # Grouped route for chat
│   │   ├── api/
│   │   │   ├── chat/route.ts         # POST/DELETE chat endpoints
│   │   │   ├── chat/[id]/stream/     # Stream resumption
│   │   │   ├── history/              # Chat history API
│   │   │   └── session/              # User session API
│   │   ├── chat/[id]/page.tsx        # Individual chat page
│   │   ├── page.tsx                  # Chat home
│   │   ├── layout.tsx                # Chat layout with sidebar
│   │   └── actions.ts                # Server actions
│   ├── globals.css                   # Global styles
│   └── layout.tsx                    # Root layout
│
├── components/                       # React components
│   ├── ui/                           # Radix UI wrappers (button, dialog, etc.)
│   ├── elements/
│   │   ├── streamdown-components/    # Custom markdown renderers
│   │   ├── message.tsx               # Message display
│   │   ├── actions.tsx               # Message actions
│   │   ├── tool.tsx                  # Tool call rendering
│   │   └── response.tsx              # Response content
│   ├── chat.tsx                      # Main Chat component (useChat)
│   ├── messages.tsx                  # Message list
│   ├── multimodal-input.tsx          # Chat input
│   ├── sidebar-history.tsx           # Chat history sidebar
│   └── databricks-message-citation.tsx  # Citation links
│
├── databricks/                       # Databricks-specific integration
│   ├── auth/
│   │   ├── databricks-auth.ts        # Main auth module (server-only)
│   │   ├── databricks-auth-node.ts   # Node.js auth utilities
│   │   └── auth-headers.ts           # Header utilities
│   ├── db/
│   │   ├── schema.ts                 # Drizzle schema definition
│   │   ├── queries.ts                # Database operations (server-only)
│   │   ├── connection.ts             # Connection pooling
│   │   ├── connection-pool.ts        # OAuth-aware pool
│   │   └── migrate.ts                # Migration runner
│   ├── providers/
│   │   ├── databricks-provider/      # Custom AI SDK provider
│   │   │   ├── chat-agent-language-model/
│   │   │   ├── fmapi-language-model/
│   │   │   ├── responses-agent-language-model/
│   │   │   └── databricks-tool-calling.ts
│   │   └── providers-server.ts       # OAuth-aware provider factory
│   └── utils/
│       ├── databricks-host-utils.ts  # Workspace hostname resolution
│       ├── databricks-chat-transport.ts  # Chat transport layer
│       └── subprocess.ts             # CLI subprocess utilities
│
├── lib/                              # Shared utilities
│   ├── ai/
│   │   ├── models.ts                 # Chat model definitions
│   │   ├── providers.ts              # Server-side provider init
│   │   └── entitlements.ts           # User type-based entitlements
│   ├── hooks/
│   │   └── use-databricks-session.ts # Session management hook
│   ├── types.ts                      # Shared TypeScript types
│   ├── utils.ts                      # Utility functions
│   ├── errors.ts                     # ChatSDKError class
│   ├── constants.ts                  # App-wide constants
│   ├── stream-cache.ts               # Stream resumption cache
│   └── chat-acl.ts                   # Access control logic
│
├── hooks/                            # Custom React hooks
│   └── use-chat-visibility.ts        # Chat privacy settings
│
├── tests/                            # Test files
│   ├── e2e/                          # Playwright E2E tests
│   ├── routes/                       # API route tests
│   ├── components/                   # Component tests
│   ├── api-mocking/                  # MSW handlers
│   ├── pages/                        # Page objects
│   ├── fixtures.ts                   # Test fixtures
│   └── helpers.ts                    # Test utilities
│
├── scripts/                          # Utility scripts
│   ├── reset-database.ts             # Database reset
│   └── get-pghost.sh                 # Get PostgreSQL host
│
├── public/                           # Static assets
│
├── databricks.yml                    # Databricks Asset Bundle config
├── drizzle.config.ts                 # Drizzle ORM config
├── next.config.ts                    # Next.js configuration
├── tsconfig.json                     # TypeScript config
├── biome.jsonc                       # Biome linting/formatting
├── playwright.config.ts              # Playwright config
├── middleware.ts                     # Next.js middleware
└── package.json                      # Dependencies and scripts
```

---

## Development Conventions

### Code Style (Biome)

This project uses **Biome** (NOT ESLint or Prettier) for linting and formatting.

**Key Style Rules:**
- **Indentation:** 2 spaces
- **Line Width:** 80 characters
- **Quotes:** Single quotes for JavaScript, double quotes for JSX attributes
- **Semicolons:** Always required
- **Trailing Commas:** All cases
- **Arrow Parentheses:** Always use parentheses
- **Bracket Spacing:** Enabled

**Commands:**
```bash
npm run lint        # Lint and auto-fix
npm run format      # Format code
npm run lint:fix    # Lint + format
```

### TypeScript Patterns

- **Strict mode enabled:** All types must be explicit
- **Type imports:** Use `type` keyword: `import type { Foo } from './bar'`
- **Interfaces vs Types:** Use interfaces for public APIs, types for internal
- **Inference:** Prefer `InferSelectModel` from Drizzle for DB types

### Server vs Client Components

**Critical Pattern:**
- **Server Components:** Default in Next.js App Router, can access DB/auth directly
- **Client Components:** Must use `'use client'` directive at top of file
- **Server-Only Modules:** Auth (`databricks-auth.ts`) and DB (`queries.ts`) must NEVER be imported in client components

**Example:**
```typescript
// ❌ WRONG - Never do this in a client component
'use client';
import { getAuthSession } from '@/databricks/auth/databricks-auth';

// ✅ CORRECT - Use server components or API routes
// Server Component (no 'use client'):
const session = await getAuthSession();
```

### Error Handling Pattern

Use the custom `ChatSDKError` class for all application errors:

```typescript
import { ChatSDKError } from '@/lib/errors';

// Throw error
throw new ChatSDKError('unauthorized:chat');

// Return error response
return new ChatSDKError('rate_limit:chat').toResponse();
```

**Error Format:** `${ErrorType}:${Surface}`
- Examples: `'unauthorized:chat'`, `'bad_request:api'`, `'offline:chat'`

### Naming Conventions

- **Files:** kebab-case (`chat-header.tsx`, `use-databricks-session.ts`)
- **Components:** PascalCase (`ChatHeader`, `MultimodalInput`)
- **Functions:** camelCase (`generateUUID`, `getAuthSession`)
- **Constants:** SCREAMING_SNAKE_CASE (`DEFAULT_CHAT_MODEL`, `DATABRICKS_TOOL_CALL_ID`)
- **Database tables:** PascalCase (`User`, `Chat`, `Message_v2`)

### Import Organization

Path aliases are configured in `tsconfig.json`:
```typescript
import { Chat } from '@/components/chat';
import { getAuthSession } from '@/databricks/auth/databricks-auth';
import { saveMessages } from '@/databricks/db/queries';
```

---

## Database

### Schema (`ai_chatbot`)

**Location:** `databricks/db/schema.ts`

**Tables:**

1. **User**
   ```typescript
   {
     id: text          // Databricks user ID (primary key)
     email: varchar    // User email
   }
   ```

2. **Chat**
   ```typescript
   {
     id: uuid                    // Chat ID (auto-generated)
     createdAt: timestamp        // Creation timestamp
     title: text                 // Chat title
     userId: text                // FK → User.id
     visibility: 'public'|'private'  // Privacy setting
     lastContext: jsonb          // LanguageModelUsage (token counts)
   }
   ```

3. **Message_v2** (current version)
   ```typescript
   {
     id: uuid           // Message ID (auto-generated)
     chatId: uuid       // FK → Chat.id
     role: varchar      // 'user' | 'assistant' | 'system'
     parts: json        // UIMessagePart[] array
     attachments: json  // Attachment[] array
     createdAt: timestamp
   }
   ```

4. **Message** (deprecated) - Kept for backward compatibility

### Using Drizzle ORM

**Querying:**
```typescript
import { getChatById, saveMessages } from '@/databricks/db/queries';

// Get a chat
const chat = await getChatById({ id: 'uuid-here' });

// Save messages
await saveMessages({
  messages: [{
    id: generateUUID(),
    chatId: 'chat-id',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello' }],
    attachments: [],
    createdAt: new Date(),
  }],
});
```

**Important Pattern:** Always use the server-only `queries.ts` module. Never import Drizzle directly in client components.

### Database Connection

Connection pooling is OAuth-aware and handles token refresh automatically:

```typescript
// Connection automatically fetched with fresh OAuth token
const db = await ensureDb();
```

### Migrations

**Generate migration:**
```bash
npm run db:generate
```

**Apply migrations:**
```bash
npm run db:migrate
```

**Database Studio (GUI):**
```bash
npm run db:studio
```

**Reset database (⚠️ destructive):**
```bash
npm run db:reset
```

**Migration files:** Located in `databricks/db/migrations/`

---

## Authentication

### Two Authentication Modes

1. **Local Development:** Databricks CLI Auth (User-to-Machine OAuth)
2. **Deployed App:** Service Principal OAuth

### How It Works

**Entry Point:** `databricks/auth/databricks-auth.ts` (server-only module)

**Main Function:**
```typescript
export async function getAuthSession(request?: Request): Promise<AuthSession | null>
```

**Authentication Flow:**

**Local Dev:**
1. Checks for Databricks CLI profile via `DATABRICKS_CONFIG_PROFILE` env var
2. Runs `databricks auth token` subprocess to get OAuth token
3. Caches token until expiration
4. Fetches user info from SCIM API (`/api/2.0/preview/scim/v2/Me`)

**Deployed App:**
1. Reads injected headers (`X-Forwarded-User`, `X-Forwarded-Email`, etc.)
2. Uses service principal credentials from env vars
3. Fetches OAuth token from `/oidc/v1/token`
4. Caches token with automatic refresh

### Usage Pattern

**In Server Components:**
```typescript
import { getAuthSession } from '@/databricks/auth/databricks-auth';

export default async function Page() {
  const session = await getAuthSession();

  if (!session?.user) {
    // Handle unauthorized
  }

  // Use session.user.id, session.user.email, etc.
}
```

**In API Routes:**
```typescript
export async function POST(request: Request) {
  const session = await getAuthSession(request);

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  // Proceed with authenticated user
}
```

**Client-Side Session Hook:**
```typescript
import { useDatabricksSession } from '@/lib/hooks/use-databricks-session';

export function MyComponent() {
  const { session, isLoading } = useDatabricksSession();

  if (isLoading) return <div>Loading...</div>;
  if (!session) return <div>Not authenticated</div>;

  return <div>Hello {session.user.email}</div>;
}
```

### Environment Variables

**Local Development:**
```bash
DATABRICKS_CONFIG_PROFILE=your_profile_name
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
```

**Deployed App (auto-injected):**
```bash
DATABRICKS_CLIENT_ID=service-principal-client-id
DATABRICKS_CLIENT_SECRET=service-principal-secret
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
```

---

## AI/LLM Integration

### Databricks Provider

**Location:** `databricks/providers/databricks-provider/`

The custom Databricks provider implements the AI SDK provider interface for three model types:

1. **Foundation Models (FMAPI)** - Databricks-hosted LLMs (e.g., Llama 3.3 70B)
2. **Chat Agents (Agent/v2/chat)** - Custom code agents and Agent Bricks
3. **Response Agents (Agent/v2/responses)** - Alternative agent task type

### Provider Initialization

**Server-Side Only:**
```typescript
import { myProvider } from '@/lib/ai/providers';

const model = await myProvider.languageModel('chat-model');
const result = streamText({
  model,
  messages: convertToModelMessages(messages),
});
```

**OAuth-Aware Provider:**
The provider automatically fetches fresh OAuth tokens for each request via `getDatabricksServerProvider()`.

### Model Configuration

**Location:** `lib/ai/models.ts`

```typescript
export const DEFAULT_CHAT_MODEL: string = 'chat-model';

export interface ChatModel {
  id: string;
  name: string;
  description: string;
}

export const chatModels: Array<ChatModel> = [];
```

**Note:** The model list is currently empty. The actual model is configured via the `DATABRICKS_SERVING_ENDPOINT` environment variable.

### Tool Calling

Databricks uses a custom tool calling pattern:

**All tool calls are normalized to a single tool ID:**
```typescript
export const DATABRICKS_TOOL_CALL_ID = 'databricks_tool';
```

**Tool metadata is preserved in the stream transformation:**
```typescript
tools: {
  [DATABRICKS_TOOL_CALL_ID]: DATABRICKS_TOOL_DEFINITION,
}
```

**Original Databricks tool information** (name, parameters, results) is stored in the message parts.

### Streaming Configuration

```typescript
const result = streamText({
  model,
  messages: convertToModelMessages(messages),
  onFinish: ({ usage }) => {
    // Save token usage
  },
  tools: {
    [DATABRICKS_TOOL_CALL_ID]: DATABRICKS_TOOL_DEFINITION,
  },
});
```

### Stream Response Transformation

**Location:** `databricks/providers/databricks-provider/stream-transformers/`

Databricks responses are transformed to AI SDK format:
- Text content
- Tool calls (with metadata preservation)
- Reasoning tokens (thinking/reflection)
- Source citations (from knowledge bases)

---

## Stream Management

### Stream Resumption Pattern

The app implements sophisticated stream resumption to handle network interruptions without losing messages.

**Key Components:**

1. **Stream Cache** (`lib/stream-cache.ts`)
   - Stores active streams with cursor tracking
   - Maintains stream position for recovery
   - Clears on successful completion

2. **Custom Chat Transport** (`databricks/utils/databricks-chat-transport.ts`)
   - Extends default AI SDK transport
   - Tracks stream parts with cursor
   - Prepares reconnection requests with cursor header

3. **Stream Resumption Endpoint** (`app/(chat)/api/chat/[id]/stream/route.ts`)
   - Accepts `X-Resume-Stream-Cursor` header
   - Returns cached stream from cursor position

### How It Works

**Client-Side:**
```typescript
const [streamCursor, setStreamCursor] = useState(0);

const { useChat } = useChat({
  transport: new ExtendedDefaultChatTransport({
    onStreamPart: (part) => {
      // Track cursor position
      setStreamCursor((cursor) => cursor + 1);
    },
    prepareReconnectToStreamRequest({ id }) {
      return {
        api: `/api/chat/${id}/stream`,
        headers: {
          'X-Resume-Stream-Cursor': streamCursor.toString(),
        },
      };
    },
  }),
  onError: (error) => {
    // Retry up to 3 times
    if (retryCount < 3) {
      resumeStream();
    }
  },
  onFinish: () => {
    // Check if stream actually finished
    if (lastPart?.type !== 'finish' && retryCount < 3) {
      resumeStream();
    }
  },
});
```

**Server-Side:**
```typescript
// Store stream in cache
streamCache.storeStream({
  streamId,
  chatId,
  stream,
});

// Resume from cursor
const cursor = parseInt(request.headers.get('X-Resume-Stream-Cursor') || '0');
return streamCache.resumeStream(streamId, cursor);
```

### Retry Logic

- **Max Attempts:** 3 retries
- **Triggers:** Network errors, incomplete finish
- **Reset:** Counter resets on receiving any stream part

---

## Message Structure & Rendering

### UIMessagePart Structure

Messages are composed of **parts** (array of content pieces):

```typescript
type UIMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: any }
  | { type: 'image'; image: string; mimeType: string }
  | { type: 'thinking'; thinking: string }  // Reasoning tokens
```

### Custom Streamdown Renderers

**Location:** `components/elements/streamdown-components/`

The app uses custom renderers for markdown elements:

1. **Code Blocks** (`code.tsx`) - Syntax highlighting with Shiki, copy button
2. **Tables** (`table.tsx`) - Styled data tables
3. **Images** (`image.tsx`) - Image display with loading states
4. **Mermaid Diagrams** - Rendered via Mermaid.js

### Message Rendering Flow

1. **Message Component** (`components/elements/message.tsx`)
   - Renders message container with role styling
   - Handles user vs assistant messages differently

2. **Response Component** (`components/elements/response.tsx`)
   - Iterates through message parts
   - Renders text, tool calls, reasoning separately

3. **Tool Component** (`components/elements/tool.tsx`)
   - Displays tool call name and arguments
   - Shows tool results

4. **Citation Links** (`components/databricks-message-citation.tsx`)
   - Transforms Databricks citation URLs
   - Handles Unity Catalog references

### Example Message Structure

```typescript
{
  id: 'msg-123',
  role: 'assistant',
  parts: [
    { type: 'thinking', thinking: 'Let me search the knowledge base...' },
    { type: 'text', text: 'Here is what I found:' },
    {
      type: 'tool-call',
      toolCallId: 'tool-1',
      toolName: 'search_knowledge_base',
      args: { query: 'deployment guide' }
    },
    {
      type: 'tool-result',
      toolCallId: 'tool-1',
      toolName: 'search_knowledge_base',
      result: { documents: [...] }
    },
    { type: 'text', text: 'Based on the documentation...' }
  ]
}
```

---

## Testing

### Playwright E2E Tests

**Location:** `tests/e2e/`

**Configuration:** `playwright.config.ts`
- **Browser:** Chrome only
- **Timeout:** 240 seconds
- **Workers:** 8 (local), 2 (CI)
- **Reporter:** HTML

### Test Structure

1. **Fixtures** (`tests/fixtures.ts`)
   - Authenticated browser contexts
   - Three test users: "ada", "babbage", "curie"
   - Per-worker isolation

2. **Page Objects** (`tests/pages/`)
   - `ChatPage` - Encapsulates chat page selectors and actions

3. **API Mocking** (`tests/api-mocking/`)
   - MSW request handlers
   - Deterministic responses for testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx playwright test tests/e2e/chat.test.ts

# Run in headed mode (see browser)
npx playwright test --headed

# Run in debug mode
npx playwright test --debug

# View HTML report
npx playwright show-report
```

### Test Patterns

**Example Test:**
```typescript
import { test, expect } from '@playwright/test';
import { ChatPage } from '../pages/chat';

test('should send and receive a message', async ({ page }) => {
  const chatPage = new ChatPage(page);
  await chatPage.goto();

  await chatPage.sendMessage('Hello');
  await expect(chatPage.messages).toContainText('Hello');

  // Wait for assistant response
  await chatPage.waitForAssistantResponse();
  await expect(chatPage.messages.last()).not.toContainText('Hello');
});
```

### API Mocking Pattern

**Location:** `tests/api-mocking/api-mock-handlers.ts`

```typescript
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('/api/chat', async ({ request }) => {
    // Return mock streaming response
    return HttpResponse.json({ /* mock data */ });
  }),
];
```

---

## Common Development Tasks

### Starting Development Server

```bash
# Install dependencies
npm install

# Start dev server (with turbo mode)
npm run dev

# Server starts at http://localhost:3000
```

**Note:** Telemetry is automatically disabled via `predev` script.

### Database Tasks

```bash
# Generate new migration after schema changes
npm run db:generate

# Apply migrations
npm run db:migrate

# Reset database (⚠️ destroys all data)
npm run db:reset

# Open Drizzle Studio (database GUI)
npm run db:studio

# Push schema directly (skip migrations)
npm run db:push

# Pull schema from database
npm run db:pull
```

### Modifying Database Schema

1. Edit `databricks/db/schema.ts`
2. Generate migration: `npm run db:generate`
3. Review migration in `databricks/db/migrations/`
4. Apply migration: `npm run db:migrate`

### Adding a New Component

1. Create component file in `components/` or `components/ui/`
2. Use TypeScript with proper types
3. Add `'use client'` if component uses React hooks
4. Export component

**Example:**
```typescript
'use client';

import { Button } from '@/components/ui/button';

export function MyComponent() {
  return <Button>Click me</Button>;
}
```

### Adding a Server Action

**Location:** `app/(chat)/actions.ts`

```typescript
'use server';

import { getAuthSession } from '@/databricks/auth/databricks-auth';

export async function myServerAction(data: string) {
  const session = await getAuthSession();

  if (!session?.user) {
    throw new Error('Unauthorized');
  }

  // Perform server-side operation
  return { success: true };
}
```

**Usage in Client Component:**
```typescript
'use client';

import { myServerAction } from '@/app/(chat)/actions';

export function MyComponent() {
  async function handleClick() {
    const result = await myServerAction('data');
  }

  return <button onClick={handleClick}>Action</button>;
}
```

### Debugging Streams

**Enable verbose logging:**
```typescript
// In useChat or streamText
onData: (dataPart) => {
  console.log('[Stream Data]', dataPart);
},
onError: (error) => {
  console.error('[Stream Error]', error);
},
onFinish: () => {
  console.log('[Stream Finished]');
}
```

**Check stream cache:**
```typescript
import { streamCache } from '@/lib/stream-cache';

// Check active streams
console.log('Active streams:', streamCache.getActiveStreams());
```

### Working with Different Models

Models are configured via environment variables:

```bash
# In .env.local
DATABRICKS_SERVING_ENDPOINT=your-agent-endpoint-name
```

**To use a different model:**
1. Update `DATABRICKS_SERVING_ENDPOINT` in `.env.local`
2. Restart dev server
3. Model will be used for all new chats

### Linting and Formatting

```bash
# Lint only
npm run lint

# Format only
npm run format

# Lint + format
npm run lint:fix
```

**Note:** This project uses **Biome**, not ESLint or Prettier.

---

## Deployment

### Databricks Asset Bundle (DAB)

**Configuration:** `databricks.yml`

### Deployment Targets

- **dev** (default) - Development environment
- **staging** - Staging environment
- **prod** - Production environment

### Deployment Steps

1. **Validate bundle:**
   ```bash
   databricks bundle validate
   ```

2. **Deploy (creates all resources):**
   ```bash
   databricks bundle deploy
   ```

   **For specific target:**
   ```bash
   databricks bundle deploy -t staging
   ```

3. **Start the app:**
   ```bash
   databricks bundle run databricks_chatbot
   ```

4. **View deployment summary:**
   ```bash
   databricks bundle summary
   ```

### Resources Created

- **Lakebase Instance:** PostgreSQL database for chat storage
- **Database Catalog:** Unity Catalog connection
- **App Resource:** Databricks App with serving endpoint permissions

### Environment Variables (Deployed)

These are automatically injected by Databricks Apps:

- `DATABRICKS_CLIENT_ID` - Service principal client ID
- `DATABRICKS_CLIENT_SECRET` - Service principal secret
- `DATABRICKS_HOST` - Workspace URL
- `X-Forwarded-User` - Current user ID (header)
- `X-Forwarded-Email` - Current user email (header)

### Customizing Deployment

**Edit `databricks.yml`:**

```yaml
variables:
  serving_endpoint_name:
    default: "your-endpoint-name"
  database_instance_name:
    default: "chatbot-lakebase-custom"
  resource_name_suffix:
    default: "your-suffix"
```

**Deploy with variables:**
```bash
databricks bundle deploy --var serving_endpoint_name="my-agent"
```

---

## Important Patterns to Follow

### 1. Server-Only Module Pattern

**NEVER import these modules in client components:**
- `databricks/auth/databricks-auth.ts`
- `databricks/db/queries.ts`
- `databricks/db/connection.ts`

**✅ Correct Usage:**
```typescript
// Server Component (no 'use client')
import { getAuthSession } from '@/databricks/auth/databricks-auth';

export default async function Page() {
  const session = await getAuthSession();
  // ...
}

// API Route
export async function POST(request: Request) {
  const session = await getAuthSession(request);
  // ...
}
```

**❌ Incorrect Usage:**
```typescript
'use client';  // ❌ DON'T DO THIS
import { getAuthSession } from '@/databricks/auth/databricks-auth';
```

### 2. Database Connection Pattern

Always use `ensureDb()` for fresh connections:

```typescript
import { getChatById } from '@/databricks/db/queries';

// ✅ Correct - uses ensureDb() internally
const chat = await getChatById({ id });

// ❌ Don't access Drizzle directly in new code
```

### 3. Error Handling Pattern

Use `ChatSDKError` for all application errors:

```typescript
import { ChatSDKError } from '@/lib/errors';

// Throw error
if (!session?.user) {
  throw new ChatSDKError('unauthorized:chat');
}

// Return error response (in API routes)
if (!session?.user) {
  return new ChatSDKError('unauthorized:chat').toResponse();
}
```

### 4. Stream Caching Pattern

Always clear and store streams properly:

```typescript
import { streamCache } from '@/lib/stream-cache';

// Before starting new stream
streamCache.clearActiveStream(chatId);

// Store stream
streamCache.storeStream({ streamId, chatId, stream });

// Clear on finish
streamCache.clearActiveStream(chatId);
```

### 5. Message Saving Pattern

Save messages immediately after sending and on stream completion:

```typescript
// Save user message
await saveMessages({
  messages: [{
    id: message.id,
    chatId,
    role: 'user',
    parts: message.parts,
    attachments: [],
    createdAt: new Date(),
  }],
});

// Save assistant response in onFinish
onFinish: async ({ responseMessage }) => {
  await saveMessages({
    messages: [{
      id: responseMessage.id,
      chatId,
      role: responseMessage.role,
      parts: responseMessage.parts,
      attachments: [],
      createdAt: new Date(),
    }],
  });
}
```

### 6. OAuth Token Refresh Pattern

The provider automatically handles token refresh. No manual intervention needed.

```typescript
// ✅ Provider automatically refreshes tokens
const model = await myProvider.languageModel('chat-model');
```

### 7. Access Control Pattern

Always check chat ownership before operations:

```typescript
const chat = await getChatById({ id });

if (chat?.userId !== session.user.id) {
  return new ChatSDKError('forbidden:chat').toResponse();
}
```

---

## Troubleshooting

### Common Issues

#### 1. Authentication Errors

**Problem:** `unauthorized:chat` error

**Solutions:**
- **Local Dev:** Ensure `DATABRICKS_CONFIG_PROFILE` is set and run `databricks auth login`
- **Check token:** Run `databricks auth token --profile $DATABRICKS_CONFIG_PROFILE`
- **Verify profile:** Check `~/.databrickscfg` file

#### 2. Database Connection Errors

**Problem:** Cannot connect to database

**Solutions:**
- Verify `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` in `.env.local`
- Ensure Lakebase instance is running: `databricks bundle summary`
- Check service principal has `CAN_CONNECT_AND_CREATE` permission

#### 3. Schema Not Found

**Problem:** `schema "ai_chatbot" does not exist`

**Solutions:**
- Run migrations: `npm run db:migrate`
- Check connection is to correct database
- Verify schema name in `databricks/db/schema.ts`

#### 4. Stream Interruption

**Problem:** Messages not completing

**Solutions:**
- Check network connectivity
- Verify stream resumption is working (check console logs)
- Increase timeout if needed: `export const maxDuration = 120;` in `route.ts`
- Check if backend agent is responding

#### 5. Model Not Found

**Problem:** `serving endpoint not found`

**Solutions:**
- Verify `DATABRICKS_SERVING_ENDPOINT` is set correctly
- Check endpoint exists: `databricks serving-endpoints get --name <endpoint>`
- Ensure service principal has `CAN_QUERY` permission

#### 6. Build Errors

**Problem:** Build fails with TypeScript errors

**Solutions:**
- Run `npm install` to ensure all dependencies installed
- Check TypeScript version: `npx tsc --version`
- Clear `.next` folder: `rm -rf .next`
- Rebuild: `npm run build`

#### 7. Biome Linting Errors

**Problem:** Lint errors blocking development

**Solutions:**
- Auto-fix: `npm run lint:fix`
- Check specific file: `npx biome check <file>`
- Temporarily disable rule in `biome.jsonc` if needed

#### 8. OAuth Token Expiration

**Problem:** Intermittent auth failures

**Solutions:**
- Tokens are cached and auto-refreshed
- If issues persist, clear token cache and restart
- Check token validity: `databricks auth token`

### Debug Mode

**Enable verbose logging:**

Add to `.env.local`:
```bash
DEBUG=databricks:*
NODE_ENV=development
```

**Check logs:**
- Server logs: Console where `npm run dev` is running
- Browser logs: Browser DevTools console
- Network logs: Browser DevTools Network tab

---

## Additional Resources

- **Databricks Asset Bundles:** https://docs.databricks.com/dev-tools/bundles/
- **Databricks Apps:** https://docs.databricks.com/generative-ai/agent-framework/chat-app
- **Vercel AI SDK:** https://sdk.vercel.ai/docs
- **Drizzle ORM:** https://orm.drizzle.team/
- **Next.js App Router:** https://nextjs.org/docs/app
- **Biome:** https://biomejs.dev/

---

## Summary

This is a sophisticated, production-ready chatbot application with:
- **Databricks-native** authentication and infrastructure
- **Resilient streaming** with automatic resumption
- **Multi-tenant** architecture with user-scoped data
- **Type-safe** database operations with Drizzle ORM
- **Comprehensive testing** with Playwright and MSW
- **Modern stack** using Next.js 15, React 18, TypeScript

**Key principles:**
1. Keep server-only modules separate from client components
2. Always use proper error handling with `ChatSDKError`
3. Leverage stream caching for resilience
4. Follow Biome style guide
5. Use server actions for mutations
6. Test with Playwright for E2E coverage

For questions or issues, refer to the README.md and official Databricks documentation.
