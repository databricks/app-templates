# Code Review Action Items

**Project**: TypeScript Agent Template (agent-langchain-ts)
**Branch**: `responses-api-invocations`
**Review Date**: 2026-02-06
**Overall Status**: ✅ Ready to merge with critical fixes

---

## 🔴 Critical - Must Fix Before Merge

### 1. Fix eval() Security Vulnerability

**Priority**: CRITICAL
**File**: `src/tools.ts:50`
**Effort**: 15 minutes

**Issue**: Direct `eval()` usage allows arbitrary code execution

**Current Code**:
```typescript
const result = eval(expression);
```

**Solution Option A** (Recommended):
```typescript
import { evaluate } from 'mathjs'; // Add dependency: npm install mathjs

export const calculatorTool = tool(
  async ({ expression }) => {
    try {
      // mathjs safely evaluates math expressions
      const result = evaluate(expression);
      return `Result: ${result}`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error evaluating expression: ${message}`;
    }
  },
  // ... rest unchanged
);
```

**Solution Option B** (If keeping eval):
```typescript
// ⚠️  SECURITY WARNING: This uses eval() and is for DEMONSTRATION ONLY
// DO NOT USE IN PRODUCTION - Replace with mathjs or similar before deploying
// This tool can execute arbitrary JavaScript code and compromise your server
// eslint-disable-next-line no-eval
const result = eval(expression);
```

---

### 2. Fix Memory Leak in toolCallIds Map

**Priority**: HIGH
**File**: `src/routes/invocations.ts:102, 173`
**Effort**: 30 minutes

**Issue**: If a tool never completes (hangs, errors, crashes), Map entries persist forever

**Current Code**:
```typescript
const toolCallIds = new Map<string, string>(); // Line 102
// ...
toolCallIds.delete(toolKey); // Line 173 - only cleanup on success
```

**Solution**:
```typescript
// At line 102, add:
const toolCallIds = new Map<string, string>();

// After line 197, before res.end():
toolCallIds.clear(); // Clean up any remaining entries

// Also add in catch block at line 206:
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Streaming error:", error);
  toolCallIds.clear(); // Clean up on error
  res.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: "response.failed" })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
```

---

### 3. Fix SSE Error Handling

**Priority**: HIGH
**File**: `src/routes/invocations.ts:199-206`
**Effort**: 15 minutes

**Issue**: Error response doesn't send completion events, causing clients to hang

**Current Code**:
```typescript
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Streaming error:", error);
  res.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`);
  res.end();
}
```

**Solution**:
```typescript
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Streaming error:", error);
  res.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: "response.failed" })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
```

---

### 4. Add Input Size Limits

**Priority**: HIGH
**File**: `src/server.ts:68`
**Effort**: 5 minutes

**Issue**: No protection against large payload DoS attacks

**Current Code**:
```typescript
app.use(express.json());
```

**Solution**:
```typescript
app.use(express.json({ limit: '10mb' }));
```

---

### 5. Fix Hardcoded Experiment ID

**Priority**: HIGH (blocks other developers)
**File**: `databricks.yml:29`
**Effort**: 10 minutes

**Issue**: Personal experiment ID will cause permission errors for other users

**Current Code**:
```yaml
experiment_id: "2610606164206831"
```

**Solution**:
```yaml
variables:
  mlflow_experiment_id:
    description: "MLflow experiment ID for traces"
    default: "2610606164206831"

resources:
  apps:
    agent_langchain_ts:
      # ...
      resources:
        - name: experiment
          experiment:
            experiment_id: ${var.mlflow_experiment_id}
            permission: CAN_MANAGE
```

And document in README.md how to set your own experiment ID.

---

## ⚠️ High Priority - Fix Soon After Merge

### 6. Add response.output_item.added for Message

**Priority**: MEDIUM
**File**: `src/routes/invocations.ts:~104`
**Effort**: 15 minutes

**Issue**: Missing message initialization event before text deltas (per Responses API spec)

**Solution**:
```typescript
let textOutputId = `text_${Date.now()}`;
let hasStartedText = false;
const toolCallIds = new Map<string, string>();

// Add this before the for await loop (after line 103):
res.write(`data: ${JSON.stringify({
  type: "response.output_item.added",
  item: { type: "message", id: textOutputId, role: "assistant" }
})}\n\n`);

for await (const event of eventStream) {
  // ... rest of code
}
```

---

### 7. Add Rate Limiting

**Priority**: MEDIUM
**File**: `src/server.ts`
**Effort**: 30 minutes

**Issue**: No protection against abuse, rapid-fire requests, or cost explosion

**Solution**:
```bash
npm install express-rate-limit
```

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to invocations endpoint
app.use('/invocations', limiter);
```

---

### 8. Make Agent Verbose Mode Configurable

**Priority**: MEDIUM
**File**: `src/agent.ts:140`
**Effort**: 10 minutes

**Issue**: Always logs in production, creating log noise

**Current Code**:
```typescript
const executor = new AgentExecutor({
  agent,
  tools,
  verbose: true,
  maxIterations: 10,
});
```

**Solution**:
```typescript
const executor = new AgentExecutor({
  agent,
  tools,
  verbose: process.env.NODE_ENV === 'development' || config.verbose === true,
  maxIterations: config.maxIterations ?? 10,
});
```

And add to AgentConfig interface:
```typescript
export interface AgentConfig {
  // ... existing fields
  verbose?: boolean;
  maxIterations?: number;
}
```

---

### 9. Fix Proxy Error Handling in UI Exports

**Priority**: MEDIUM
**File**: `ui-patches/exports.ts:73-79`
**Effort**: 20 minutes

**Issue**: Returns JSON error for SSE requests, breaking client parsing

**Current Code**:
```typescript
} catch (error) {
  console.error('[/invocations proxy] Error:', error);
  res.status(502).json({
    error: 'Proxy error',
    message: error instanceof Error ? error.message : String(error),
  });
}
```

**Solution**:
```typescript
} catch (error) {
  console.error('[/invocations proxy] Error:', error);

  // Check if this is an SSE request
  if (req.headers.accept?.includes('text/event-stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.status(502);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Proxy error' })}\n\n`);
    res.write('data: [DONE]\n\n');
  } else {
    res.status(502).json({
      error: 'Proxy error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  res.end();
}
```

---

### 10. Add Request Timeout

**Priority**: MEDIUM
**File**: `src/routes/invocations.ts`
**Effort**: 30 minutes

**Issue**: Long-running requests can hang indefinitely

**Solution**:
```typescript
// Inside the if (stream) block, after line 99:
const REQUEST_TIMEOUT = 300000; // 5 minutes
const timeout = setTimeout(() => {
  console.warn('Request timeout reached');
  toolCallIds.clear();
  res.write(`data: ${JSON.stringify({
    type: "error",
    error: "Request timeout exceeded"
  })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: "response.failed" })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}, REQUEST_TIMEOUT);

try {
  // ... existing streaming code

  // Before line 197 (before res.end()):
  clearTimeout(timeout);

} catch (error: unknown) {
  clearTimeout(timeout);
  // ... rest of error handling
}
```

---

### 11. Improve Error Messages with Remediation

**Priority**: MEDIUM
**File**: Multiple files
**Effort**: 2 hours

**Issue**: Error messages don't suggest how to fix the problem

**Examples**:

**invocations.ts:64**:
```typescript
// Current:
return res.status(400).json({
  error: "No user message found in input",
});

// Better:
return res.status(400).json({
  error: "No user message found in input",
  message: "The 'input' array must contain at least one message with role='user'",
  example: { input: [{ role: "user", content: "Your message here" }] }
});
```

**invocations.ts:54**:
```typescript
// Current:
return res.status(400).json({
  error: "Invalid request format",
  details: parsed.error.format(),
});

// Better:
return res.status(400).json({
  error: "Invalid request format",
  message: "Request body must match Responses API schema",
  details: process.env.NODE_ENV === 'development' ? parsed.error.format() : undefined,
  documentation: "https://docs.databricks.com/.../responses-api.html"
});
```

---

### 12. Add Source Code Exclusions to databricks.yml

**Priority**: MEDIUM
**File**: `databricks.yml:21`
**Effort**: 10 minutes

**Issue**: Uploads unnecessary files (node_modules, tests, .git)

**Solution**:
```yaml
resources:
  apps:
    agent_langchain_ts:
      name: agent-lc-ts-${var.resource_name_suffix}
      description: "TypeScript LangChain agent with MLflow tracing"
      source_code_path: ./
      source_code_excludes:
        - node_modules
        - ui/node_modules
        - .git
        - .gitignore
        - tests
        - "**/*.test.ts"
        - "**/*.md"
        - .env
        - .env.*
        - .databricks
```

---

## 💡 Nice-to-Have Improvements

### 13. Add Comprehensive Error Handling Tests

**Priority**: LOW
**Effort**: 4-6 hours

**Missing Test Scenarios**:

Create `tests/error-handling.test.ts`:
```typescript
describe("Error Handling", () => {
  test("should handle tool execution errors", async () => {
    // Test calculator with invalid expression
  });

  test("should handle LLM API errors", async () => {
    // Mock ChatDatabricks to throw error
  });

  test("should handle tool timeout", async () => {
    // Mock slow tool that exceeds timeout
  });

  test("should handle client disconnect during streaming", async () => {
    // Abort request mid-stream
  });

  test("should handle large tool output (>1MB)", async () => {
    // Tool returns huge response
  });

  test("should handle concurrent requests", async () => {
    // Send 10 requests simultaneously
  });

  test("should handle malformed SSE data", async () => {
    // Tool output contains SSE control chars
  });
});
```

---

### 14. Add Metrics and Observability

**Priority**: LOW
**Effort**: 4 hours

**Solution**: Add Prometheus metrics

```bash
npm install prom-client
```

Create `src/metrics.ts`:
```typescript
import { Counter, Histogram, Registry } from 'prom-client';

const register = new Registry();

export const requestCounter = new Counter({
  name: 'agent_requests_total',
  help: 'Total number of agent requests',
  labelNames: ['endpoint', 'status'],
  registers: [register]
});

export const requestDuration = new Histogram({
  name: 'agent_request_duration_seconds',
  help: 'Agent request duration in seconds',
  labelNames: ['endpoint'],
  registers: [register]
});

export const toolCallCounter = new Counter({
  name: 'agent_tool_calls_total',
  help: 'Total number of tool calls',
  labelNames: ['tool_name', 'status'],
  registers: [register]
});

export { register };
```

Add to `server.ts`:
```typescript
import { register } from './metrics.js';

app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
});
```

---

### 15. Add Performance Benchmarks

**Priority**: LOW
**Effort**: 2 hours

Create `tests/performance.test.ts`:
```typescript
describe("Performance Benchmarks", () => {
  test("simple query should respond within 5 seconds", async () => {
    const start = Date.now();
    await invokeAgent(agent, "Hello");
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(5000);
  });

  test("tool calling should respond within 10 seconds", async () => {
    const start = Date.now();
    await invokeAgent(agent, "Calculate 2 + 2");
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(10000);
  });

  test("should handle 10 concurrent requests", async () => {
    const promises = Array(10).fill(0).map(() =>
      fetch("http://localhost:5001/invocations", {
        method: "POST",
        body: JSON.stringify({ input: [{ role: "user", content: "hi" }] })
      })
    );
    const results = await Promise.all(promises);
    expect(results.every(r => r.ok)).toBe(true);
  });
});
```

---

### 16. Add Production Deployment Guide

**Priority**: LOW
**Effort**: 3 hours

Create `DEPLOYMENT.md`:
```markdown
# Production Deployment Guide

## Pre-Deployment Checklist

### Security
- [ ] Replace eval() in calculator tool with safe alternative
- [ ] Enable rate limiting
- [ ] Set input size limits
- [ ] Configure CORS properly
- [ ] Review and rotate secrets
- [ ] Enable HTTPS only

### Configuration
- [ ] Set production environment variables
- [ ] Configure MLflow experiment
- [ ] Set up monitoring
- [ ] Configure alerts
- [ ] Set resource limits

### Testing
- [ ] Run full test suite
- [ ] Run load tests
- [ ] Test deployed app
- [ ] Verify tracing works
- [ ] Test error scenarios

## Deployment Steps

1. Build the application
2. Configure databricks.yml
3. Deploy with databricks bundle
4. Verify health endpoint
5. Run smoke tests
6. Monitor logs

## Monitoring

### Key Metrics
- Request rate
- Error rate
- Response latency
- Tool call frequency
- Token usage
- Cost

### Alerts
- High error rate (>5%)
- High latency (>10s p95)
- Service down
- High cost (>$X/day)
```

---

### 17. Add Architecture Decision Records

**Priority**: LOW
**Effort**: 2 hours

Create `docs/adr/`:

**ADR-001: Two-Server Architecture**
```markdown
# ADR-001: Two-Server Architecture for Local Development

## Status
Accepted

## Context
Need to integrate TypeScript agent with e2e-chatbot-app-next UI template...

## Decision
Use separate agent (5001) and UI (3001) servers locally, merge in production...

## Consequences
Positive: Clean separation, UI template remains standalone...
Negative: Slightly more complex local setup...
```

---

### 18. Add More Tool Examples

**Priority**: LOW
**Effort**: 3 hours

Create `src/tools/examples/`:

**Structured Output Tool**:
```typescript
export const dataAnalysisTool = tool(
  async ({ query }) => {
    return JSON.stringify({
      status: "success",
      data: { /* ... */ },
      metadata: { timestamp: new Date().toISOString() }
    });
  },
  {
    name: "analyze_data",
    description: "Returns structured JSON analysis",
    schema: z.object({
      query: z.string().describe("Analysis query")
    })
  }
);
```

**External API Tool**:
```typescript
export const weatherApiTool = tool(
  async ({ location }) => {
    const API_KEY = process.env.WEATHER_API_KEY;
    const response = await fetch(
      `https://api.weather.com/v1?location=${location}&key=${API_KEY}`,
      { timeout: 5000 }
    );
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    return await response.json();
  },
  // ... schema
);
```

---

### 19. Improve Documentation

**Priority**: LOW
**Effort**: 4 hours

**Add to README.md**:
- MCP primer section explaining what it is
- Troubleshooting common errors with solutions
- Performance tuning guide
- Migration guide from Python template

**Add to CLAUDE.md**:
- Debugging section (how to debug SSE, inspect traces)
- Visual diagrams (event sequence with arrows)
- Common mistakes and how to avoid them

**Create new docs**:
- `API.md` - Complete API reference
- `TOOLS.md` - Guide to creating custom tools
- `TROUBLESHOOTING.md` - Common issues and solutions

---

### 20. Add Request/Response Validation Tests

**Priority**: LOW
**Effort**: 2 hours

Create `tests/validation.test.ts`:
```typescript
describe("Request Validation", () => {
  test("should reject empty input array", async () => {
    const response = await fetch("http://localhost:5001/invocations", {
      method: "POST",
      body: JSON.stringify({ input: [] })
    });
    expect(response.status).toBe(400);
  });

  test("should reject input without user message", async () => {
    const response = await fetch("http://localhost:5001/invocations", {
      method: "POST",
      body: JSON.stringify({
        input: [{ role: "assistant", content: "hi" }]
      })
    });
    expect(response.status).toBe(400);
  });

  test("should reject payload >10MB", async () => {
    const largeContent = "A".repeat(11 * 1024 * 1024);
    const response = await fetch("http://localhost:5001/invocations", {
      method: "POST",
      body: JSON.stringify({
        input: [{ role: "user", content: largeContent }]
      })
    });
    expect(response.status).toBe(413);
  });
});
```

---

## Summary

### By Priority

**🔴 Critical (Must fix before merge)**: 5 items, ~1.5 hours total
- eval() security fix
- Memory leak fix
- SSE error handling
- Input size limits
- Hardcoded experiment ID

**⚠️ High Priority (Fix within 1 week)**: 7 items, ~4 hours total
- Message initialization event
- Rate limiting
- Verbose mode config
- Proxy error handling
- Request timeout
- Error message improvements
- Source code exclusions

**💡 Nice-to-Have (Fix when time permits)**: 8 items, ~25 hours total
- Comprehensive error tests
- Metrics/observability
- Performance benchmarks
- Deployment guide
- ADRs
- More tool examples
- Documentation improvements
- Validation tests

### Total Effort Estimate
- **Critical**: 1.5 hours
- **High Priority**: 4 hours
- **Nice-to-Have**: 25 hours
- **Grand Total**: ~30.5 hours

---

## Next Steps

1. ✅ **Review this action items list** with the team
2. 🔴 **Fix all critical items** (1.5 hours)
3. ✅ **Merge PR** after critical fixes
4. ⚠️ **Create follow-up tickets** for high-priority items
5. 💡 **Backlog nice-to-have** items for future sprints

---

**Generated**: 2026-02-06
**Reviewer**: Claude Code
**Project**: agent-langchain-ts
