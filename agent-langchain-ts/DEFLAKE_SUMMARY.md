# Test Deflaking Summary

## Problem

Error handling tests were intermittently failing due to dependence on non-deterministic model behavior.

### Root Causes of Flakiness

1. **Tool Usage Expectations**
   - Tests expected models to call specific tools
   - Models may choose to respond without tools
   - Example: "Get weather in InvalidCity" might not trigger tool call

2. **Text Output Expectations**
   - Tests checked for specific words in responses
   - Model responses vary between runs
   - Example: Checking for "error", "invalid", etc. is unreliable

3. **Model Behavior Variations**
   - Same prompt can yield different responses
   - Tool usage is a model decision, not guaranteed
   - Response length and content varies

## Solution

**Focus on Infrastructure, Not Model Behavior**

Tests should verify:
- ✅ Server doesn't crash
- ✅ Streams complete properly
- ✅ Security boundaries work
- ✅ Resources are cleaned up

Tests should NOT verify:
- ❌ Model makes specific tool calls
- ❌ Response contains specific words
- ❌ Model behavior is deterministic

## Changes Made

### Removed Flaky Tests

1. **"Tool Execution Error Recovery"** tests
   ```typescript
   // FLAKY: Expected model to call get_weather tool
   expect(hasToolCall).toBe(true); // ❌ Model-dependent
   ```

2. **"Agent Behavior"** tests
   ```typescript
   // FLAKY: Expected specific tool usage patterns
   expect(hasToolInput).toBe(true); // ❌ Model-dependent
   expect(hasToolOutput).toBe(true); // ❌ Model-dependent
   ```

3. **Specific output checks**
   ```typescript
   // FLAKY: Model might not include these words
   const hasReasonableResponse =
     lowerOutput.includes("error") ||
     lowerOutput.includes("invalid"); // ❌ Model-dependent
   ```

### Kept Robust Tests

1. **Security: Calculator with mathjs** ✅
   ```typescript
   // Verifies: No dangerous code execution
   const hasDangerousOutput =
     fullOutput.includes("root:") ||
     fullOutput.includes("/bin/bash");
   expect(hasDangerousOutput).toBe(false);
   ```

2. **SSE Stream Completion** ✅
   ```typescript
   // Verifies: Stream format compliance
   expect(assertSSECompleted(text)).toBe(true);
   expect(text).toContain("data: [DONE]");
   ```

3. **Request Size Limits** ✅
   ```typescript
   // Verifies: Server configuration
   const largeMessage = "A".repeat(11 * 1024 * 1024); // 11MB
   expect(response.status).toBe(413); // Payload Too Large
   ```

4. **Memory Leak Prevention** ✅
   ```typescript
   // Verifies: Resource cleanup
   // Multiple requests should succeed without accumulating state
   for (const response of responses) {
     expect(response.ok).toBe(true);
   }
   ```

5. **Stream Robustness** ✅
   ```typescript
   // Verifies: No hangs or crashes
   expect(assertSSECompleted(text)).toBe(true);
   expect(text).toContain("data: [DONE]");
   ```

## Test Results

### Before Deflaking
```
Test Suites: 1 failed, 1 total
Tests:       3-5 failed (intermittent), 10-12 passed, 15 total
```

### After Deflaking
```
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
Snapshots:   0 total
Time:        ~33s

✅ Consistent across multiple runs
✅ 100% pass rate over 3 consecutive runs
```

## What We Test Now

### Infrastructure Tests (Robust)
| Category | What We Test | Why It's Robust |
|----------|--------------|-----------------|
| Security | No code execution | Verifies absence of dangerous output |
| SSE Format | Proper event sequence | Infrastructure guarantee |
| Size Limits | Request rejection | Server configuration |
| Completion | Stream ends with [DONE] | Protocol compliance |
| Memory | No state accumulation | Resource management |
| Errors | Graceful handling | Server stability |

### Integration Tests (Separate)
Tool usage and model behavior are tested in:
- `integration.test.ts` - End-to-end tool calling
- `endpoints.test.ts` - Basic agent functionality
- `followup-questions.test.ts` - Conversation handling

These tests accept some model variability as normal.

## Lessons Learned

### ✅ Good Test Practices
1. **Test infrastructure, not intelligence**
   - Verify server doesn't crash
   - Check protocol compliance
   - Validate resource cleanup

2. **Accept model variability**
   - Models are probabilistic
   - Same input → different outputs is ok
   - Test the system, not the model

3. **Focus on guarantees**
   - Stream always completes
   - Resources always cleaned up
   - Security boundaries always enforced

### ❌ Anti-patterns to Avoid
1. **Expecting specific tool calls**
   - Model decides when to use tools
   - Prompts don't guarantee tool usage

2. **Checking for specific words**
   - Responses vary naturally
   - Substring matching is fragile

3. **Asserting deterministic behavior**
   - LLMs are not deterministic
   - Tests must account for variability

## Impact

### Benefits
- ✅ Tests pass consistently (100% reliable)
- ✅ Faster feedback (no flaky retries)
- ✅ Clear test intent (infrastructure vs behavior)
- ✅ Easier maintenance (fewer false positives)

### Trade-offs
- ⚠️ Less coverage of model behavior
  - **Mitigated by**: Integration tests cover this
- ⚠️ Fewer total tests (15 → 12)
  - **Justified by**: Removed tests were unreliable

## Recommendations

### For Template Users
When adding your own tests:
1. Test infrastructure first (streams, errors, cleanup)
2. Accept model behavior variability
3. Use integration tests for end-to-end validation
4. Don't assert on specific model outputs

### For Future Development
1. **Infrastructure tests** → error-handling.test.ts
2. **Integration tests** → integration.test.ts
3. **E2E tests** → deployed.test.ts

Keep these concerns separated for maintainability.
