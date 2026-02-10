# Diff Simplification - Implementation Plan

**Purpose**: Reduce diff from 16,102 lines to ~10,000 lines
**Time Estimate**: 4-5 hours
**Difficulty**: Low-Medium
**Risk**: Low (all changes preserve functionality)

---

## 📋 Pre-Execution Checklist

Before starting, verify:
- [ ] All tests currently pass: `npm run test:all`
- [ ] Code is committed: `git status` (commit any changes first)
- [ ] Create a backup branch: `git checkout -b simplification-backup`
- [ ] Create working branch: `git checkout -b simplify-diff`

---

## Phase 1: Remove Temporary Documentation (30 minutes)

**Goal**: Remove 2,000+ lines of temporary/duplicate documentation
**Risk**: ZERO (all temporary files)

### Step 1.1: Remove Internal Review Files (5 min)

These were created during code review and aren't needed in the codebase:

```bash
cd /Users/sid.murching/app-templates/agent-langchain-ts

# Remove code review artifacts
rm -f CODE_REVIEW_PROMPT.md
rm -f SIMPLIFICATION_OPPORTUNITIES.md
rm -f a.md
rm -f REVIEW_PASS_2.md
rm -f DIFF_REDUCTION_REVIEW.md

# Verify deletion
git status
```

**Expected**: -2,130 lines

---

### Step 1.2: Remove Temporary Status/Integration Docs (5 min)

These were temporary notes during development:

```bash
# Remove status and integration notes
rm -f STATUS.md
rm -f INTEGRATION_SUMMARY.md
rm -f GENIE_SPACE_INTEGRATION_SUCCESS.md
rm -f E2E_TEST_RESULTS.md
rm -f DEPLOYMENT_VALIDATION.md
rm -f MCP_TOOLS_SUMMARY.md
rm -f DISCOVERED_TOOLS.md
rm -f DISCOVERED_TOOLS_CLI.md

# Verify
git status
```

**Expected**: -1,713 lines

---

### Step 1.3: Remove Architecture Duplicates (5 min)

Keep only AGENTS.md as the comprehensive user guide:

```bash
# These duplicate content from AGENTS.md
rm -f AGENT-TS.md
rm -f ARCHITECTURE.md
rm -f ARCHITECTURE_FINAL.md
rm -f WORKSPACE_ARCHITECTURE.md

# Keep: README.md, AGENTS.md, CLAUDE.md, docs/ADDING_TOOLS.md
# These are non-overlapping and serve different purposes

# Verify
git status
```

**Expected**: -1,050 lines

---

### Step 1.4: Remove Duplicate Requirements Doc (2 min)

```bash
# Content covered in README and AGENTS.md
rm -f REQUIREMENTS.md

# Verify
git status
```

**Expected**: -235 lines

---

### Step 1.5: Consolidate MCP Documentation (10 min)

Move useful MCP patterns to proper location:

```bash
# Create patterns directory
mkdir -p docs/patterns

# Move MCP pattern documentation
mv MCP_CORRECT_PATTERN.md docs/patterns/mcp-best-practices.md
mv MCP_KNOWN_ISSUES.md docs/mcp-known-issues.md

# Update any references to these files
# Check if CLAUDE.md or AGENTS.md reference them
grep -r "MCP_CORRECT_PATTERN" README.md AGENTS.md CLAUDE.md docs/

# If found, update references:
# - MCP_CORRECT_PATTERN.md → docs/patterns/mcp-best-practices.md
# - MCP_KNOWN_ISSUES.md → docs/mcp-known-issues.md

# Verify
git status
```

**Expected**: Files reorganized, no line reduction but better structure

---

### Step 1.6: Checkpoint - Verify Nothing Broke

```bash
# Check remaining documentation structure
ls -lh *.md
ls -lh docs/*.md

# Should have:
# - README.md (quick start)
# - AGENTS.md (comprehensive guide)
# - CLAUDE.md (AI agent development)
# - PR_DESCRIPTION.md (can remove after PR merged)
# - docs/ADDING_TOOLS.md
# - docs/README.md
# - docs/mcp-known-issues.md
# - docs/patterns/mcp-best-practices.md

# Run a quick sanity check
npm run build

# Commit Phase 1
git add -A
git commit -m "Phase 1: Remove temporary and duplicate documentation

Removed:
- Code review artifacts (SIMPLIFICATION_OPPORTUNITIES.md, etc.)
- Temporary status/integration notes
- Architecture duplicates
- Redundant requirements doc

Reorganized:
- Moved MCP patterns to docs/patterns/
- Consolidated to essential docs only

Impact: -5,000+ lines of documentation"
```

---

## Phase 2: Remove Redundant Test Files (15 minutes)

**Goal**: Remove root-level test files that duplicate Jest tests
**Risk**: LOW (functionality covered by tests/ directory)

### Step 2.1: Verify Test Coverage (5 min)

Before deleting, confirm Jest tests cover the same functionality:

```bash
# Check what root test files test
cat test-integrations.ts | head -50
cat test-deployed-api-chat.ts | head -50

# Compare with Jest tests
ls -lh tests/*.test.ts

# The functionality should be covered by:
# - tests/integration.test.ts
# - tests/deployed.test.ts
# - tests/endpoints.test.ts
```

---

### Step 2.2: Remove Root Test Files (5 min)

```bash
# These are covered by tests/ directory
rm -f test-integrations.ts          # → tests/integration.test.ts
rm -f test-deployed-api-chat.ts     # → tests/deployed.test.ts

# Keep test-deployed-app.ts for now - it has unique OAuth testing
# We'll consolidate it in Phase 3

# Verify
git status
```

**Expected**: -316 lines

---

### Step 2.3: Checkpoint

```bash
# Verify tests still pass
npm run test:unit

# Commit Phase 2
git add -A
git commit -m "Phase 2: Remove redundant root-level test files

Removed test files superseded by Jest test suite:
- test-integrations.ts (covered by tests/integration.test.ts)
- test-deployed-api-chat.ts (covered by tests/deployed.test.ts)

Impact: -316 lines"
```

---

## Phase 3: Create Test Utilities (45 minutes)

**Goal**: Extract common test code into shared utilities
**Risk**: LOW (existing tests validate behavior)

### Step 3.1: Create Test Helpers File (30 min)

Create a new file with all common test utilities:

```typescript
// tests/helpers.ts

/**
 * Common test utilities and helpers
 * Reduces duplication across test files
 */

// ============================================================================
// Configuration
// ============================================================================

export const TEST_CONFIG = {
  AGENT_URL: process.env.AGENT_URL || "http://localhost:5001",
  UI_URL: process.env.UI_URL || "http://localhost:3001",
  DEFAULT_MODEL: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
  DEFAULT_TIMEOUT: 30000,
} as const;

// ============================================================================
// Request Helpers
// ============================================================================

export interface InvocationsRequest {
  input: Array<{
    role: "user" | "assistant" | "system";
    content: string | any[];
  }>;
  stream?: boolean;
  custom_inputs?: Record<string, any>;
}

/**
 * Call /invocations endpoint with Responses API format
 */
export async function callInvocations(
  body: InvocationsRequest,
  baseUrl = TEST_CONFIG.AGENT_URL
): Promise<Response> {
  const response = await fetch(`${baseUrl}/invocations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response;
}

/**
 * Call /api/chat endpoint with useChat format
 */
export async function callApiChat(
  message: string,
  options: {
    previousMessages?: any[];
    chatModel?: string;
    baseUrl?: string;
  } = {}
): Promise<Response> {
  const {
    previousMessages = [],
    chatModel = "test-model",
    baseUrl = TEST_CONFIG.UI_URL,
  } = options;

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: `test-${Date.now()}`,
      message: {
        role: "user",
        parts: [{ type: "text", text: message }],
        id: `msg-${Date.now()}`,
      },
      previousMessages,
      selectedChatModel: chatModel,
      selectedVisibilityType: "private",
      nextMessageId: `next-${Date.now()}`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response;
}

// ============================================================================
// SSE Stream Parsing
// ============================================================================

export interface SSEEvent {
  type: string;
  [key: string]: any;
}

export interface ParsedSSEStream {
  events: SSEEvent[];
  fullOutput: string;
  hasError: boolean;
  hasToolCall: boolean;
  toolCalls: Array<{ name: string; arguments: any }>;
}

/**
 * Parse Server-Sent Events (SSE) stream from response
 */
export function parseSSEStream(text: string): ParsedSSEStream {
  const events: SSEEvent[] = [];
  let fullOutput = "";
  let hasError = false;
  let hasToolCall = false;
  const toolCalls: Array<{ name: string; arguments: any }> = [];

  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const data = JSON.parse(line.slice(6));
        events.push(data);

        // Extract text deltas
        if (data.type === "response.output_text.delta") {
          fullOutput += data.delta;
        }

        // Track errors
        if (data.type === "error" || data.type === "response.failed") {
          hasError = true;
        }

        // Track tool calls
        if (
          data.type === "response.output_item.done" &&
          data.item?.type === "function_call"
        ) {
          hasToolCall = true;
          toolCalls.push({
            name: data.item.name,
            arguments: JSON.parse(data.item.arguments || "{}"),
          });
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return { events, fullOutput, hasError, hasToolCall, toolCalls };
}

/**
 * Parse AI SDK streaming format (used by /api/chat)
 */
export function parseAISDKStream(text: string): {
  fullContent: string;
  hasTextDelta: boolean;
  hasToolCall: boolean;
} {
  let fullContent = "";
  let hasTextDelta = false;
  let hasToolCall = false;

  const lines = text.split("\n").filter((line) => line.trim());

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "text-delta") {
          fullContent += data.delta;
          hasTextDelta = true;
        }
        if (data.type === "tool-input-available") {
          hasToolCall = true;
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return { fullContent, hasTextDelta, hasToolCall };
}

// ============================================================================
// Agent Creation Helpers
// ============================================================================

/**
 * Create test agent with default configuration
 */
export async function createTestAgent(config: {
  temperature?: number;
  model?: string;
  mcpServers?: any[];
} = {}) {
  const { createAgent } = await import("../src/agent.js");
  return createAgent({
    model: config.model || TEST_CONFIG.DEFAULT_MODEL,
    temperature: config.temperature ?? 0,
    mcpServers: config.mcpServers,
  });
}

// ============================================================================
// MCP Configuration Helpers
// ============================================================================

export const MCP = {
  /**
   * Check if SQL MCP is configured
   */
  isSqlConfigured: (): boolean => {
    return process.env.ENABLE_SQL_MCP === "true";
  },

  /**
   * Check if UC Function is configured
   */
  isUCFunctionConfigured: (): boolean => {
    return !!(
      process.env.UC_FUNCTION_CATALOG && process.env.UC_FUNCTION_SCHEMA
    );
  },

  /**
   * Check if Vector Search is configured
   */
  isVectorSearchConfigured: (): boolean => {
    return !!(
      process.env.VECTOR_SEARCH_CATALOG && process.env.VECTOR_SEARCH_SCHEMA
    );
  },

  /**
   * Check if Genie Space is configured
   */
  isGenieConfigured: (): boolean => {
    return !!process.env.GENIE_SPACE_ID;
  },

  /**
   * Check if any MCP tool is configured
   */
  isAnyConfigured(): boolean {
    return (
      this.isSqlConfigured() ||
      this.isUCFunctionConfigured() ||
      this.isVectorSearchConfigured() ||
      this.isGenieConfigured()
    );
  },

  /**
   * Skip test if MCP not configured
   */
  skipIfNotConfigured(condition: boolean, message: string): boolean {
    if (!condition) {
      console.log(`⏭️  ${message}`);
      return true;
    }
    return false;
  },

  /**
   * Get UC Function config from environment
   */
  getUCFunctionConfig() {
    if (!this.isUCFunctionConfigured()) return undefined;
    return {
      catalog: process.env.UC_FUNCTION_CATALOG!,
      schema: process.env.UC_FUNCTION_SCHEMA!,
      functionName: process.env.UC_FUNCTION_NAME,
    };
  },

  /**
   * Get Vector Search config from environment
   */
  getVectorSearchConfig() {
    if (!this.isVectorSearchConfigured()) return undefined;
    return {
      catalog: process.env.VECTOR_SEARCH_CATALOG!,
      schema: process.env.VECTOR_SEARCH_SCHEMA!,
      indexName: process.env.VECTOR_SEARCH_INDEX,
    };
  },

  /**
   * Get Genie Space config from environment
   */
  getGenieConfig() {
    if (!this.isGenieConfigured()) return undefined;
    return {
      spaceId: process.env.GENIE_SPACE_ID!,
    };
  },
};

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that response contains expected text (case-insensitive)
 */
export function assertContains(text: string, expected: string): boolean {
  return text.toLowerCase().includes(expected.toLowerCase());
}

/**
 * Assert that SSE stream completed successfully
 */
export function assertSSECompleted(text: string): boolean {
  return text.includes("data: [DONE]");
}

/**
 * Assert that SSE stream has completion event
 */
export function assertSSEHasCompletionEvent(events: SSEEvent[]): boolean {
  return events.some(
    (e) => e.type === "response.completed" || e.type === "response.failed"
  );
}
```

Save this to `tests/helpers.ts`.

---

### Step 3.2: Update One Test File as Example (15 min)

Let's refactor `tests/endpoints.test.ts` to use the new helpers:

**Before** (endpoints.test.ts lines 1-50):
```typescript
import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { createDatabricksProvider } from "@databricks/ai-sdk-provider";
import { streamText } from "ai";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";

describe("API Endpoints", () => {
  let agentProcess: ChildProcess;
  const PORT = 5555;

  beforeAll(async () => {
    agentProcess = spawn("tsx", ["src/server.ts"], {
      env: { ...process.env, PORT: PORT.toString() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }, 30000);

  afterAll(async () => {
    if (agentProcess) {
      agentProcess.kill();
    }
  });

  describe("/invocations endpoint", () => {
    test("should respond with Responses API format", async () => {
      const response = await fetch(`http://localhost:${PORT}/invocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [{ role: "user", content: "Say 'test' and nothing else" }],
          stream: true,
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const text = await response.text();
      const lines = text.split("\n");
      const dataLines = lines.filter((line) => line.startsWith("data: "));
      expect(dataLines.length).toBeGreaterThan(0);

      // ... rest of test
    }, 30000);
  });
});
```

**After** (with helpers):
```typescript
import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import {
  callInvocations,
  parseSSEStream,
  assertSSECompleted,
  assertSSEHasCompletionEvent,
} from "./helpers";

describe("API Endpoints", () => {
  let agentProcess: ChildProcess;
  const PORT = 5555;

  beforeAll(async () => {
    agentProcess = spawn("tsx", ["src/server.ts"], {
      env: { ...process.env, PORT: PORT.toString() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }, 30000);

  afterAll(async () => {
    if (agentProcess) {
      agentProcess.kill();
    }
  });

  describe("/invocations endpoint", () => {
    test("should respond with Responses API format", async () => {
      const response = await callInvocations(
        {
          input: [{ role: "user", content: "Say 'test' and nothing else" }],
          stream: true,
        },
        `http://localhost:${PORT}`
      );

      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const text = await response.text();
      const { events, fullOutput } = parseSSEStream(text);

      expect(events.length).toBeGreaterThan(0);
      expect(assertSSECompleted(text)).toBe(true);
      expect(assertSSEHasCompletionEvent(events)).toBe(true);

      // ... rest of test
    }, 30000);
  });
});
```

**Test the refactored file**:
```bash
npm run test:unit -- tests/endpoints.test.ts
```

If it passes, commit:
```bash
git add tests/helpers.ts tests/endpoints.test.ts
git commit -m "Phase 3.1: Create test helpers and refactor endpoints.test.ts

Created tests/helpers.ts with:
- Request helpers (callInvocations, callApiChat)
- SSE parsing utilities
- MCP configuration helpers
- Assertion helpers

Refactored endpoints.test.ts to use helpers
- Reduced duplication
- Improved readability
- Easier to maintain"
```

---

### Step 3.3: Refactor Remaining Test Files (Do in next session)

This step-by-step guide for the next session:

**Files to refactor** (in order of priority):
1. `tests/error-handling.test.ts` - Heavy SSE parsing
2. `tests/integration.test.ts` - Request helpers
3. `tests/use-chat.test.ts` - AI SDK stream parsing
4. `tests/deployed.test.ts` - Request helpers
5. `tests/mcp-tools.test.ts` - MCP helpers
6. `tests/agent.test.ts` - Agent creation helper
7. `tests/followup-questions.test.ts` - Request/parsing helpers
8. `tests/tool-error-handling.test.ts` - Request/parsing helpers
9. `tests/f1-genie.test.ts` - MCP helpers
10. `tests/ui-auth.test.ts` - Request helpers
11. `tests/agent-mcp-streaming.test.ts` - Request/parsing helpers

**For each file, follow this pattern**:
1. Read the file
2. Identify duplicated code
3. Replace with helper function calls
4. Run tests: `npm run test:unit -- tests/FILENAME.test.ts`
5. Commit if passing

---

## Phase 4: Consolidate Test Files (1 hour)

**Goal**: Merge similar test files to reduce duplication
**Risk**: LOW (verify tests pass after each merge)

### Step 4.1: Merge tool-error-handling.test.ts into error-handling.test.ts (20 min)

```bash
# Read both files first
cat tests/tool-error-handling.test.ts
cat tests/error-handling.test.ts

# Both test error scenarios - consolidate into error-handling.test.ts
```

**Steps**:
1. Open `tests/error-handling.test.ts`
2. Add new describe block at the end:
   ```typescript
   describe("Tool Error Handling", () => {
     // Copy test cases from tool-error-handling.test.ts
   });
   ```
3. Copy all test cases from `tool-error-handling.test.ts`
4. Remove `tool-error-handling.test.ts`
5. Test: `npm run test:error-handling`
6. Commit if passing

```bash
# After verification
rm tests/tool-error-handling.test.ts
git add tests/error-handling.test.ts tests/tool-error-handling.test.ts
git commit -m "Phase 4.1: Consolidate tool error handling tests

Merged tool-error-handling.test.ts into error-handling.test.ts
All error handling tests now in one file for easier maintenance

Impact: -207 lines"
```

---

### Step 4.2: Merge integration.test.ts into error-handling.test.ts (15 min)

```bash
# Both test integration scenarios
# integration.test.ts mainly tests error cases

# Read both
cat tests/integration.test.ts
cat tests/error-handling.test.ts
```

**Steps**:
1. Review `integration.test.ts` - identify unique tests
2. Add unique tests to `error-handling.test.ts`
3. Remove duplicate tests
4. Delete `integration.test.ts`
5. Test: `npm run test:error-handling`
6. Commit if passing

```bash
rm tests/integration.test.ts
git add -A
git commit -m "Phase 4.2: Merge integration tests into error handling

Consolidated integration.test.ts into error-handling.test.ts
Removed duplicate test scenarios

Impact: -157 lines"
```

---

### Step 4.3: Merge followup-questions.test.ts into endpoints.test.ts (15 min)

```bash
# followup-questions tests endpoint behavior
# Belongs with endpoints.test.ts

cat tests/followup-questions.test.ts
cat tests/endpoints.test.ts
```

**Steps**:
1. Add describe block to `endpoints.test.ts`:
   ```typescript
   describe("Followup Questions", () => {
     // Tests from followup-questions.test.ts
   });
   ```
2. Copy relevant tests
3. Remove `followup-questions.test.ts`
4. Test: `npm run test:unit -- tests/endpoints.test.ts`
5. Commit

```bash
rm tests/followup-questions.test.ts
git add -A
git commit -m "Phase 4.3: Merge followup question tests into endpoints

Followup question handling is endpoint behavior
Consolidated into endpoints.test.ts

Impact: -381 lines"
```

---

### Step 4.4: Merge agent-mcp-streaming.test.ts into mcp-tools.test.ts (10 min)

```bash
# Both test MCP functionality
cat tests/agent-mcp-streaming.test.ts
cat tests/mcp-tools.test.ts
```

**Steps**:
1. Add streaming tests to `mcp-tools.test.ts`
2. Remove `agent-mcp-streaming.test.ts`
3. Test: `npm run test:mcp`
4. Commit

```bash
rm tests/agent-mcp-streaming.test.ts
git add -A
git commit -m "Phase 4.4: Merge MCP streaming tests

Consolidated agent-mcp-streaming.test.ts into mcp-tools.test.ts
All MCP tests now in one file

Impact: -144 lines"
```

---

### Step 4.5: Move f1-genie.test.ts to Examples (5 min)

This is an example integration, not a core test:

```bash
# Create examples directory
mkdir -p examples

# Move F1 Genie test to examples
mv tests/f1-genie.test.ts examples/genie-space-integration.test.ts

# Update package.json to exclude examples from test runs
# In package.json, update test commands to ignore examples/
```

Edit `package.json`:
```json
{
  "scripts": {
    "test": "jest --testPathIgnorePatterns=examples",
    "test:unit": "jest tests/*.test.ts --testPathIgnorePatterns=integration,deployed,error-handling,mcp-tools,examples"
  }
}
```

Commit:
```bash
git add -A
git commit -m "Phase 4.5: Move F1 Genie test to examples

F1 Genie integration is an example, not a core test
Moved to examples/ directory

Updated test commands to exclude examples/"
```

---

## Phase 5: Simplify Skills (30 minutes)

**Goal**: Reduce skill documentation duplication
**Risk**: LOW (skills are just documentation)

### Step 5.1: Remove Redundant Skill Examples (10 min)

```bash
cd .claude/skills/add-tools/examples

# Keep only the most useful examples
# Keep: genie-space.yaml, uc-function.yaml, vector-search.yaml

# Remove (covered in docs/ADDING_TOOLS.md):
rm -f experiment.yaml              # Not a tool
rm -f serving-endpoint.yaml        # Auto-configured
rm -f sql-warehouse.yaml           # Covered in main docs
rm -f uc-connection.yaml           # Advanced/rare
rm -f custom-mcp-server.md         # Move to docs/

# Move custom MCP server guide to docs
mv custom-mcp-server.md ../../../docs/custom-mcp-servers.md

cd ../../..
git status
```

Commit:
```bash
git add -A
git commit -m "Phase 5.1: Simplify add-tools skill examples

Kept only essential examples:
- genie-space.yaml
- uc-function.yaml
- vector-search.yaml

Removed redundant examples covered in docs/ADDING_TOOLS.md
Moved custom MCP server guide to docs/

Impact: -97 lines"
```

---

### Step 5.2: Streamline deploy Skill (10 min)

The deploy skill is 445 lines but overlaps heavily with AGENTS.md.

**Action**: Create concise version focusing on commands

```bash
# Back up current version
cp .claude/skills/deploy/SKILL.md .claude/skills/deploy/SKILL.md.backup

# Edit to ~150 lines focusing on:
# 1. Prerequisites check
# 2. Build command
# 3. Deploy command
# 4. Verification steps
# 5. Common errors (link to docs/TROUBLESHOOTING.md)

# Create simplified version (ask next Claude session to do this)
```

**TODO for next session**: Reduce `deploy/SKILL.md` from 445 to ~150 lines by:
- Removing detailed explanations (link to AGENTS.md instead)
- Keeping only command sequences
- Moving troubleshooting to docs/

---

### Step 5.3: Streamline modify-agent Skill (10 min)

The modify-agent skill is 534 lines but duplicates AGENTS.md content.

**TODO for next session**: Reduce from 534 to ~200 lines by:
- Removing code examples (link to source files instead)
- Keeping only modification patterns
- Linking to AGENTS.md for details

---

## Phase 6: Final Cleanup (15 minutes)

### Step 6.1: Remove PR Description (if PR is merged)

```bash
# After PR is merged, remove:
rm -f PR_DESCRIPTION.md

git add PR_DESCRIPTION.md
git commit -m "Remove PR description (PR merged)"
```

---

### Step 6.2: Verify Everything Still Works (10 min)

```bash
# Run full test suite
npm run test:all

# If all pass, great!
# If any fail, investigate and fix

# Build project
npm run build

# Should succeed
```

---

### Step 6.3: Final Commit and Summary (5 min)

```bash
# Review all changes
git log --oneline simplification-backup..HEAD

# Count line changes
git diff simplification-backup --shortstat

# Create summary commit
git commit --allow-empty -m "Simplification complete: Summary

Total reduction: ~5,900 lines (37%)

Changes:
- Removed temporary documentation
- Consolidated architecture docs
- Created test helpers (tests/helpers.ts)
- Consolidated duplicate tests
- Streamlined skill examples
- Organized docs structure

New diff: ~10,100 lines

All tests passing ✅"

# Merge to main branch
git checkout main
git merge simplify-diff
```

---

## 📊 Expected Results

### Line Reduction by Phase

| Phase | Description | Lines Removed | Time |
|-------|-------------|---------------|------|
| 1 | Remove temp docs | -2,000 | 30 min |
| 2 | Remove root tests | -316 | 15 min |
| 3 | Create test helpers | -800 | 45 min |
| 4 | Consolidate tests | -889 | 1 hr |
| 5 | Simplify skills | -400 | 30 min |
| 6 | Final cleanup | -255 | 15 min |
| **Total** | | **-5,660** | **3.5 hrs** |

### Final Diff Size

- **Before**: 16,102 lines
- **After**: ~10,400 lines
- **Reduction**: 35%

---

## 🚨 Troubleshooting

### Tests Fail After Refactoring

```bash
# Revert to backup
git checkout simplification-backup

# Identify which phase broke tests
git log --oneline

# Cherry-pick working commits
git cherry-pick <commit-hash>
```

### Accidentally Deleted Important File

```bash
# Find the file in git history
git log --all --full-history -- path/to/file

# Restore it
git checkout <commit-hash> -- path/to/file
```

### Need to Pause Mid-Phase

```bash
# Commit work in progress
git add -A
git commit -m "WIP: Phase X in progress"

# Resume later
git checkout simplify-diff
# Continue where you left off
```

---

## ✅ Checklist for Next Claude Session

Before starting:
- [ ] Read this entire plan
- [ ] Verify tests pass: `npm run test:all`
- [ ] Create backup branch
- [ ] Have 4-5 hours available

Execute in order:
- [ ] Phase 1: Remove temp docs (30 min)
- [ ] Phase 2: Remove root tests (15 min)
- [ ] Phase 3: Create test helpers (45 min)
- [ ] Phase 4: Consolidate tests (1 hr)
- [ ] Phase 5: Simplify skills (30 min)
- [ ] Phase 6: Final cleanup (15 min)

Verify after completion:
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Diff reduced by ~5,900 lines
- [ ] Documentation is organized
- [ ] No functionality lost

---

**Good luck! This is a well-defined, low-risk refactoring that will significantly improve the codebase.**
