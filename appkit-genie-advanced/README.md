# appkit-genie-advanced

A Databricks App template that wraps an existing Genie Space with a richer UI than `appkit-genie`. Built on AppKit (React + TypeScript + Tailwind + Express).

**What this template demonstrates beyond `appkit-genie`:**
- **Multi-space picker** populated from the Genie REST API at runtime
- **Conversation history sidebar** — browse and resume past conversations
- **Live progress checklist** — Genie's `SUBMITTED → ASKING_AI → EXECUTING_QUERY → COMPLETED` pipeline visualized step-by-step
- **Per-message thumbs feedback** — wired to the Genie feedback endpoint
- **CSV download** for any query result, generated client-side
- **Custom AppKit plugin** (`server/plugins/genie-advanced.ts`) that calls Genie REST endpoints AppKit doesn't expose by default (`listSpaces`, `getSpace`, `listConversations`, `sendMessageFeedback`, `getMessageAttachmentQueryResult`)

## Bring your own Genie space

The fastest path: point this template at any Genie space you have access to, set two env vars, and run.

### 1. Find your Space ID

Open your Genie space in Databricks. The URL contains the ID:

```
https://<workspace>.cloud.databricks.com/genie/rooms/01f13e5abd38168298e36375fa9d6f3c
                                                    └────────── space ID ──────────┘
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
# Single space (simplest):
DATABRICKS_GENIE_SPACE_ID=01f13e5abd38168298e36375fa9d6f3c

# OR multiple spaces (the picker shows all of them):
# GENIE_SPACES=sales=01ABC...,support=01DEF...,ops=01GHI...
```

### 3. Auth

```bash
databricks auth login --host https://your-workspace.cloud.databricks.com
```

This writes a profile to `~/.databrickscfg`. If you use a non-default profile, also set `DATABRICKS_CONFIG_PROFILE=<profile-name>` in `.env`.

### 4. Run

```bash
npm install
npm run dev
```

Open the URL printed in the console (default `http://localhost:8000`) and click **Genie Advanced**. The space picker should populate with your space, the conversation list with any past conversations, and you can immediately start asking questions.

## Routes

The app exposes two pages so you can compare:

- `/genie` — minimal AppKit `<GenieChat>` on a single hardcoded alias (same as the upstream `appkit-genie` template)
- `/genie-advanced` — the full multi-pane UI described above

## Custom plugin endpoints

`server/plugins/genie-advanced.ts` registers a custom AppKit plugin. All routes execute on-behalf-of the requesting user (`asUser(req)`) so end-users only see spaces and conversations they have permission for.

| Method | Path | Genie SDK call |
|---|---|---|
| GET | `/api/genieAdvanced/spaces` | `WorkspaceClient.genie.getSpace(...)` per configured alias |
| GET | `/api/genieAdvanced/spaces/:alias/conversations` | `genie.listConversations({space_id})` |
| GET | `/api/genieAdvanced/spaces/:alias/conversations/:cid/messages/:mid/attachments/:aid/result` | `genie.getMessageAttachmentQueryResult(...)` |
| POST | `/api/genieAdvanced/spaces/:alias/conversations/:cid/messages/:mid/feedback` | `genie.sendMessageFeedback({rating})` |

The chat itself uses AppKit's existing `genie()` plugin (`POST /api/genie/:alias/messages` SSE for new messages, `GET /api/genie/:alias/conversations/:cid` SSE for history replay).

## Prerequisites

- Node.js v22+ and npm
- Databricks CLI (for deployment)
- Access to a Databricks workspace with at least one Genie space

## Code Quality

```bash
npm run typecheck
npm run lint
npm run format
```

## Deployment with Databricks Asset Bundles

### 1. Configure Bundle

Update `databricks.yml` with your workspace settings:

```yaml
targets:
  default:
    workspace:
      host: https://your-workspace.cloud.databricks.com
```

Make sure to replace all placeholder values in `databricks.yml` with your actual resource IDs.

### 2. Validate, Deploy, Run

```bash
databricks bundle validate
databricks bundle deploy
databricks bundle run <APP_NAME> -t dev
```

## Project Structure

```
client/src/
├── App.tsx
└── pages/
    ├── genie/GeniePage.tsx              # minimal <GenieChat>
    └── genie-advanced/
        ├── GenieProPage.tsx              # 3-pane layout
        ├── SpacePicker.tsx
        ├── ConversationList.tsx
        ├── MessageProgress.tsx           # streaming step checklist
        ├── MessageActions.tsx            # thumbs + CSV
        ├── api.ts                        # /api/genieAdvanced/* helpers
        └── types.ts
server/
├── server.ts
└── plugins/
    └── genie-advanced.ts                      # custom AppKit plugin
```

## Tech Stack

- **Backend**: Node.js, Express, AppKit
- **Frontend**: React, TypeScript, Vite, Tailwind, React Router, AppKit-UI
- **Databricks**: `@databricks/appkit`, `@databricks/sdk-experimental` (Genie API)
