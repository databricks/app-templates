# Agent-LangChain-TS Architecture

## Overview

This is a **standalone TypeScript agent template** that includes a full-stack chat UI. It uses an **npm workspace structure** where the agent code is the primary entry point, and the UI is automatically fetched and integrated.

## Developer Experience

### Quick Start

```bash
cd agent-langchain-ts
npm run dev
```

That's it! The setup script automatically:
1. Checks if the UI exists
2. Fetches it if needed (from sibling directory or GitHub)
3. Sets up the workspace
4. Starts both agent and UI

### Directory Structure

```
agent-langchain-ts/              ← YOU START HERE
├── src/
│   ├── agent.ts                 ← Define your agent
│   ├── server.ts                ← Main server (combines agent + UI)
│   └── routes/
│       └── invocations.ts       ← /invocations endpoint
├── ui/                          ← Auto-fetched by setup script
│   ├── client/                  ← React UI
│   ├── server/                  ← UI backend routes
│   └── packages/                ← Shared UI packages
├── scripts/
│   └── setup-ui.sh              ← Fetches UI if not present
└── package.json                 ← Workspace root
```

## How It Works

### 1. Workspace Structure

The agent uses **npm workspaces** to include the UI:

```json
{
  "workspaces": ["ui"]
}
```

Benefits:
- ✅ Type safety across agent and UI
- ✅ Single `npm install` for everything
- ✅ Shared dependencies
- ✅ Can import UI code in agent

### 2. Setup Script (setup-ui.sh)

Runs automatically before `npm run dev`:

```bash
# Check 1: UI already in workspace?
if [ -d "./ui" ]; then exit 0; fi

# Check 2: UI in sibling directory? (monorepo setup)
if [ -d "../e2e-chatbot-app-next" ]; then
  ln -s "../e2e-chatbot-app-next" "./ui"
  exit 0
fi

# Check 3: Clone from GitHub
git clone --sparse https://github.com/databricks/app-templates
mv app-templates/e2e-chatbot-app-next ./ui
```

### 3. Server Integration

**src/server.ts** combines agent and UI:

```typescript
import express from 'express';
import { invocationsRouter } from './routes/invocations';
import { chatRouter } from './ui/server/routes/chat';
import { historyRouter } from './ui/server/routes/history';

const app = express();

// Agent routes
app.use('/invocations', invocationsRouter);

// UI routes
app.use('/api/chat', chatRouter);
app.use('/api/history', historyRouter);

// Serve UI static files
app.use(express.static('./ui/client/dist'));
```

## Comparison with Python Templates

| Aspect | Python Template | TypeScript Template |
|--------|----------------|---------------------|
| **Entry Point** | agent.py | agent.ts |
| **UI Fetching** | Git clone at runtime | Git clone + symlink at setup |
| **Type Safety** | N/A | Full TS types across agent/UI |
| **Dependency Mgmt** | requirements.txt | npm workspaces |
| **Single Deploy** | ✅ Yes | ✅ Yes |
| **Monorepo Support** | ❌ No | ✅ Yes (via symlink) |

## Development Scenarios

### Scenario 1: Standalone Development (Like Python)

```bash
# Clone just the agent
git clone https://github.com/databricks/app-templates
cd app-templates/agent-langchain-ts

# Run - UI auto-fetches
npm run dev
```

✅ Setup script clones UI from GitHub

### Scenario 2: Monorepo Development (Full repo)

```bash
# Clone full repo
git clone https://github.com/databricks/app-templates
cd app-templates/agent-langchain-ts

# Run - UI auto-links
npm run dev
```

✅ Setup script symlinks to sibling `e2e-chatbot-app-next/`

### Scenario 3: Custom UI Location

```bash
# UI exists elsewhere
ln -s /path/to/my-ui ./ui
npm run dev
```

✅ Setup script detects existing `ui/` directory

## Building for Production

```bash
npm run build
```

This:
1. Runs setup script (ensures UI present)
2. Builds agent TypeScript → `dist/`
3. Builds UI → `ui/client/dist/`
4. Result: Single deployable artifact

## Deployment

### Option A: Deploy as Single App

```bash
npm run build
npm start
```

Serves both `/invocations` (agent) and UI routes.

### Option B: Deploy Agent Only

If you only want the agent API:

```typescript
// src/server.ts
import { invocationsRouter } from './routes/invocations';

app.use('/invocations', invocationsRouter);
// Don't mount UI routes
```

## FAQ

### Q: Why workspace instead of just git clone?

**A:** Workspaces give us:
- Type safety (import UI types in agent)
- Shared dependencies (no duplicate packages)
- Monorepo support (works in full app-templates repo)

### Q: What if I want a different UI?

**A:** Point `ui/` to your custom UI:
```bash
rm -rf ui
ln -s /path/to/custom-ui ui
npm run dev
```

### Q: How do I customize the agent?

**A:** Just modify `src/agent.ts`:
```typescript
export async function getAgent() {
  return createAgent({
    model: "databricks-claude-sonnet-4-5",
    tools: [myCustomTool],
    // ...
  });
}
```

### Q: Can I use this without the UI?

**A:** Yes! The agent exports `/invocations` endpoint that works standalone:
```bash
curl -X POST http://localhost:5001/invocations \
  -d '{"input":[{"role":"user","content":"hi"}],"stream":true}'
```

### Q: How is this better than two separate apps?

**A:** Single developer workflow:
1. Clone one directory
2. Modify agent code
3. Run/deploy
4. ✅ Done

No need to:
- ❌ Clone multiple repos
- ❌ Keep them in sync
- ❌ Deploy separately

## Migration from Old Architecture

**Old (Two apps):**
```
e2e-chatbot-app-next/     ← Clone this
  └── (agent + UI here)
agent-langchain-ts/       ← Clone this too
  └── (just agent)
```

**New (One app):**
```
agent-langchain-ts/       ← Clone this only
  ├── src/ (agent)
  └── ui/ (auto-fetched)
```

## Next Steps

1. **Define your agent** in `src/agent.ts`
2. **Run locally** with `npm run dev`
3. **Deploy** with Databricks Apps or Docker
4. **Customize UI** (optional) by modifying `ui/` workspace

The setup script handles all the plumbing automatically!
