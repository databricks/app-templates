# Workspace Architecture: Agent-First Development

## Problem Statement

**Previous architecture** had two separate apps:
- `e2e-chatbot-app-next/` - Full chat UI with embedded agent
- `agent-langchain-ts/` - Standalone agent template

**Issues:**
- ❌ Developer must work in two directories
- ❌ Unclear which to modify/deploy
- ❌ Different pattern from Python templates
- ❌ Doesn't match "start with agent" mental model

## New Architecture

**Agent-first approach** with workspace integration:

```
agent-langchain-ts/           ← DEVELOPER STARTS HERE
├── src/
│   ├── agent.ts              ← Your agent logic
│   ├── routes/
│   │   └── invocations.ts    ← /invocations endpoint
│   └── server.ts             ← Combines agent + UI
├── ui/                       ← Auto-fetched workspace
│   └── (e2e-chatbot-app-next)
├── scripts/
│   └── setup-ui.sh           ← Fetches UI if needed
└── package.json              ← Workspace root
```

## Key Innovation: Setup Script + Workspace

### 1. Setup Script (Python-like DX)

```bash
scripts/setup-ui.sh
```

**Logic:**
1. Check if `ui/` already exists → Done
2. Check if `../e2e-chatbot-app-next` exists → Symlink it
3. Otherwise → Clone from GitHub

**Benefits:**
- ✅ Works standalone (clones UI)
- ✅ Works in monorepo (symlinks sibling)
- ✅ Matches Python template DX

### 2. npm Workspaces (TypeScript benefits)

```json
{
  "workspaces": ["ui"]
}
```

**Benefits:**
- ✅ Type safety across agent/UI
- ✅ Single `npm install`
- ✅ Shared dependencies
- ✅ Import UI code in agent

## Developer Workflow

### Quick Start

```bash
git clone https://github.com/databricks/app-templates
cd agent-langchain-ts
npm run dev
```

**What happens:**
1. `predev` script runs `setup-ui.sh`
2. UI is fetched/linked automatically
3. Workspace is ready
4. Server starts with agent + UI

### Modify Agent

```typescript
// src/agent.ts
export async function getAgent() {
  return createAgent({
    model: "databricks-claude-sonnet-4-5",
    tools: [myTool],
  });
}
```

### Deploy

```bash
npm run build  # Builds agent + UI
npm start      # Serves /invocations + UI
```

## Comparison with Python

| Aspect | Python | TypeScript |
|--------|--------|------------|
| **Entry Point** | `agent.py` | `agent.ts` |
| **UI Fetch** | Runtime clone | Setup script clone/symlink |
| **Type Safety** | None | Full types via workspace |
| **Monorepo** | No support | Works via symlink |
| **Single Dir** | ✅ | ✅ |
| **Auto UI** | ✅ | ✅ |

## Implementation Details

### Setup Script Logic

```bash
# Priority 1: Already exists?
if [ -d "./ui" ]; then
  echo "UI present"
  exit 0
fi

# Priority 2: Sibling directory? (monorepo)
if [ -d "../e2e-chatbot-app-next" ]; then
  ln -s "../e2e-chatbot-app-next" "./ui"
  exit 0
fi

# Priority 3: Clone from GitHub
git clone --sparse https://github.com/databricks/app-templates
mv app-templates/e2e-chatbot-app-next ./ui
```

### Server Integration

```typescript
// src/server.ts
import { invocationsRouter } from './routes/invocations';
import { uiRoutes } from './ui/server';  // From workspace!

const app = express();

// Agent API
app.use('/invocations', invocationsRouter);

// UI routes (imported from workspace)
app.use('/api', uiRoutes);
app.use(express.static('./ui/client/dist'));
```

## Why This Works

### 1. Matches Python DX
- Clone one directory
- Run one command
- Everything just works

### 2. TypeScript-Native
- Workspace gives type safety
- Can import UI types in agent
- Shared tooling (build, test, lint)

### 3. Flexible
- Works standalone (clones UI)
- Works in monorepo (symlinks UI)
- Works with custom UI (point `ui/` anywhere)

### 4. Single Deploy
- One build command
- One artifact
- Serves agent + UI together

## Migration Path

### For Existing agent-langchain-ts Users

**Before:**
```bash
# Clone agent template
git clone .../agent-langchain-ts

# Manually set up UI somehow?
# Copy code from e2e-chatbot-app-next?
```

**After:**
```bash
# Clone agent template
git clone .../agent-langchain-ts
npm run dev  # UI auto-fetches!
```

### For Existing e2e-chatbot-app-next Users

**Option 1: Keep current approach**
- `e2e-chatbot-app-next` still works standalone
- No changes needed

**Option 2: Migrate to agent-first**
- Move agent logic to `agent-langchain-ts`
- Let setup script fetch UI
- Better separation of concerns

## Benefits Summary

✅ **Developer Experience**
- Single directory to work in
- Auto-fetches dependencies
- Matches Python pattern

✅ **Type Safety**
- Workspace enables imports
- Shared types between agent/UI
- Better IDE support

✅ **Flexibility**
- Works standalone
- Works in monorepo
- Works with custom UI

✅ **Deployment**
- Single build command
- Single artifact
- Unified server

## Files Changed

### agent-langchain-ts/
- `package.json` - Add workspace config, predev script
- `scripts/setup-ui.sh` - NEW: Auto-fetch UI
- `ARCHITECTURE.md` - NEW: Developer guide

### e2e-chatbot-app-next/
- No changes needed! Still works standalone
- Can be used as workspace in agent-langchain-ts

## Next Steps

1. **Test the setup script** in different scenarios
2. **Update agent-langchain-ts/src/server.ts** to import UI routes
3. **Document in main README** the new workflow
4. **Create example** showing agent customization
5. **Add to quickstart** script

## Future Enhancements

- **UI versioning** - Pin UI to specific version/tag
- **Custom UI templates** - Support multiple UI options
- **Slim agent mode** - Skip UI for API-only deployments
- **Hot reload** - Watch both agent and UI in dev mode
