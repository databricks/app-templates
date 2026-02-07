# Code Review Prompt for TypeScript Agent Template PR

Hi Claude! I need your help reviewing a new TypeScript agent template for building Databricks agents. This is a significant PR that introduces a complete production-ready template alongside our existing Python templates.

## Context

**Branch:** `responses-api-invocations`
**Base:** `main`
**Repository:** Databricks agent templates (app-templates)

This PR introduces a TypeScript implementation of our agent framework using LangChain.js. It provides:
- A working agent with tool calling capabilities
- MLflow-compatible `/invocations` endpoint (Responses API)
- Integration with our e2e-chatbot-app-next UI template
- Comprehensive testing and documentation

## Your Mission

Please conduct a thorough code review focusing on:

1. **Code Quality & Best Practices**
2. **Architecture & Design Decisions**
3. **Testing Coverage & Reliability**
4. **Documentation Completeness**
5. **Potential Issues & Edge Cases**

## Key Files to Review

### Core Implementation (Priority: HIGH)

1. **`src/routes/invocations.ts`** (230 lines)
   - MLflow-compatible Responses API endpoint
   - Server-Sent Events (SSE) streaming
   - Tool call event sequences (`.added` and `.done` events)
   - Question: Are the event sequences correct per Responses API spec?

2. **`src/agent.ts`** (252 lines)
   - LangChain agent configuration
   - Model selection and parameters
   - Tool binding
   - Question: Is the agent setup idiomatic for LangChain.js?

3. **`src/tools.ts`** (233 lines)
   - Weather, calculator, time tool implementations
   - Tool schemas using Zod
   - Question: Are these good examples? What's missing?

4. **`src/tracing.ts`** (234 lines)
   - MLflow tracing integration
   - Trace data capture
   - Question: Are we capturing the right information?

### Testing (Priority: HIGH)

5. **`test-integrations.ts`** (226 lines)
   - Local endpoint testing
   - Tool calling validation
   - Question: What test cases are we missing?

6. **`test-deployed-app.ts`** (321 lines)
   - Production app validation
   - OAuth authentication
   - UI + API testing
   - Question: Is this deployment test comprehensive enough?

7. **`tests/*.test.ts`** (Jest unit tests)
   - Agent logic tests
   - Endpoint tests
   - useChat integration tests
   - Question: Should we add more unit tests?

### Documentation (Priority: MEDIUM)

8. **`CLAUDE.md`** (461 lines)
   - Development workflow guide
   - API testing patterns
   - Responses API event sequences
   - Question: Is this clear for a new TypeScript developer?

9. **`README.md`** (361 lines)
   - Quick start guide
   - Architecture overview
   - Deployment instructions
   - Question: Would you be able to get started with this?

### Configuration (Priority: MEDIUM)

10. **`databricks.yml`** (47 lines)
    - Bundle configuration
    - Resource permissions
    - Question: Are the permissions secure and minimal?

11. **`ui-patches/exports.ts`** (83 lines)
    - Static file serving
    - /invocations proxy
    - Question: Is this injection approach clean?

## Specific Questions

### Architecture

1. **Two-Server Design**: We use separate agent (5001) and UI (3001) servers locally, but merge them in production. Is this the right approach?

2. **UI Integration**: We inject `exports.ts` into the UI server rather than forking the template. Good pattern or should we fork?

3. **Event Sequences**: The critical fix was emitting both `.added` and `.done` events for tool calls. Is our implementation correct?

### Code Quality

4. **Error Handling**: Review error handling in `src/routes/invocations.ts`. Are we catching all edge cases?

5. **Type Safety**: Are we using TypeScript effectively? Any `any` types that should be stricter?

6. **Memory Leaks**: Check `invocations.ts` for potential memory leaks (Map tracking, event streams, etc.)

### Testing

7. **Test Coverage**: What important scenarios are we NOT testing?

8. **Tool Calling Edge Cases**:
   - What happens with multiple concurrent tool calls?
   - What if a tool errors?
   - What if tool output is massive?

9. **Deployment Testing**: Is `test-deployed-app.ts` testing the right things?

### Documentation

10. **Clarity**: Is the event sequence explanation in CLAUDE.md clear? (See "Responses API Event Sequence" section)

11. **Examples**: Do we need more code examples in the documentation?

12. **Troubleshooting**: What common issues will developers hit that we haven't documented?

### Security

13. **Input Validation**: Are we validating user inputs properly?

14. **Tool Execution**: Are tools sandboxed appropriately?

15. **Secrets**: Are we handling API keys and secrets safely?

## Review Guidelines

**For Each File:**
- ✅ What's done well
- ⚠️ Potential issues or concerns
- 💡 Suggestions for improvement
- ❓ Questions or clarifications needed

**Priority Focus:**
1. Correctness of Responses API implementation
2. Security vulnerabilities
3. Testing gaps
4. Documentation clarity

**Code Examples:**
When suggesting changes, please provide:
- Specific file and line numbers
- Code snippets showing the issue
- Proposed fix with explanation

## Expected Outputs

Please structure your review as:

### 1. Executive Summary
- Overall assessment (Ready to merge / Needs work / Blocked)
- Top 3 strengths
- Top 3 concerns

### 2. Detailed Review by File
- File-by-file analysis
- Specific issues with line numbers
- Suggested fixes

### 3. Testing Analysis
- Coverage assessment
- Missing test cases
- Edge cases to consider

### 4. Documentation Assessment
- Clarity and completeness
- Missing sections
- Confusing explanations

### 5. Security Review
- Vulnerabilities found
- Input validation issues
- Secret handling problems

### 6. Recommendations
- Must-fix before merge
- Should-fix soon after
- Nice-to-have improvements

## Context: What We Fixed

The biggest challenge was getting server-side tool execution to work. Initially, we only emitted `response.output_item.done` events, which caused "No matching tool call found" errors.

By studying the Python implementation (`agent-openai-agents-sdk`), we discovered that we needed to emit **both** `.added` and `.done` events with matching `call_id` values. This allows the Databricks AI SDK provider to track tool execution properly.

**Before Fix:**
```typescript
// ❌ Only emitting .done
res.write(`data: ${JSON.stringify({
  type: "response.output_item.done",
  item: { type: "function_call", call_id: "X", ... }
})}\n\n`);
```

**After Fix:**
```typescript
// ✅ Emitting both .added and .done
res.write(`data: ${JSON.stringify({
  type: "response.output_item.added",
  item: { type: "function_call", call_id: "X", ... }
})}\n\n`);

res.write(`data: ${JSON.stringify({
  type: "response.output_item.done",
  item: { type: "function_call", call_id: "X", ... }
})}\n\n`);
```

Please validate that our implementation is correct!

## Test Results

All tests currently pass:

**Local:**
- ✅ /invocations with Databricks AI SDK provider
- ✅ /api/chat with useChat format
- ✅ /invocations with time tool
- ✅ /api/chat with time tool

**Deployed:**
- ✅ UI root (/)
- ✅ /invocations (Responses API)
- ✅ /api/chat (useChat format)
- ✅ Calculator tool
- ✅ Time tool

## How to Access the Code

The code is in the `agent-langchain-ts/` directory on the `responses-api-invocations` branch.

Key entry points:
- Start: `README.md`
- Development: `CLAUDE.md`
- Agent: `src/agent.ts`
- API: `src/routes/invocations.ts`
- Tests: `test-integrations.ts`, `test-deployed-app.ts`

## Questions?

Feel free to ask clarifying questions! I want a thorough review that will help us ship a high-quality TypeScript template for our developers.

Thank you! 🙏
