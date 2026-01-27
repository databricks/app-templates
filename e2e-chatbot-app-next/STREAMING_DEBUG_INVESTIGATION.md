# Streaming Display Investigation

## Summary
Streaming works on **main branch** but not on **feedback branch**. Tokens don't appear incrementally during streaming on the feedback branch.

## Test Results

### Main Branch (Ephemeral Mode)
✅ **WORKING** - Tokens stream incrementally
- Branch: `main`
- Mode: Ephemeral (no database, chats in memory)
- Throttle: 100ms
- Memo behavior: Both `Messages` and `PreviewMessage` components return `false` (always re-render)

### Feedback Branch (Database Mode)
❌ **NOT WORKING** - Entire message appears at once after completion
- Branch: `add-thumbs-up-down-feedback`
- Mode: Database-backed chat history
- Throttle: 50ms (optimized)
- Memo behavior: Both components return `true` when props equal (optimized memoization)

## Root Cause Analysis

The issue is a **nested memo problem**:

### Component Hierarchy
```
Chat (parent)
  └── Messages (memo with deep equality check)
        └── PreviewMessage (memo with streaming check)
```

### The Problem

1. **Messages Component Memo (feedback branch)**:
   ```typescript
   if (!equal(prevProps.messages, nextProps.messages)) return false;
   return true; // Skip re-render when equal
   ```

2. **AI SDK Behavior**: During streaming, the AI SDK likely **mutates the messages array in place** - same array reference, but updated content.

3. **Deep Equality Fails**: The `equal()` function sees the same array reference and doesn't detect the mutation.

4. **Messages Component Doesn't Re-render**: Because the deep equality check passes, Messages returns `true` and skips re-render.

5. **PreviewMessage Never Gets Updated Props**: Since Messages doesn't re-render, PreviewMessage never receives updated props, so its streaming check never executes:
   ```typescript
   // This never runs because Messages blocks re-render
   if (prevProps.isLoading || nextProps.isLoading) return false;
   ```

### Why Main Works

On main branch, both memo functions return `false` at the end, which **disables memoization entirely**. Every state update causes both components to re-render, so streaming works.

```typescript
// Main branch - always re-renders
export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  // ... checks
  return false; // Always re-render
});

export const PreviewMessage = memo(PurePreviewMessage, (prevProps, nextProps) => {
  // ... checks
  return false; // Always re-render
});
```

## Key Differences Between Branches

### chat.tsx
- **Main**: `experimental_throttle: 100`
- **Feedback**: `experimental_throttle: 50` ✅ Better for streaming
- **Main**: Removed OAuth error handling (unrelated to streaming)
- **Feedback**: Removed OAuth error handling (same)

### message.tsx
- **Main**: `return false` in memo (always re-render)
- **Feedback**: `if (prevProps.isLoading || nextProps.isLoading) return false` + `return true`
- **Feedback**: Added `initialFeedback` prop and comparison
- **Feedback**: Removed `allMessages` prop (unrelated)
- **Feedback**: Removed OAuth error inline rendering (unrelated)

### messages.tsx
- **Main**: `return false` in memo (always re-render)
- **Feedback**: `return true` in memo (skip re-render when equal) ⚠️ **THIS IS THE ISSUE**
- **Feedback**: Added `feedback` prop and comparison
- **Feedback**: Removed `allMessages` prop (unrelated)

## Hypothesis

The **Messages component memo** is blocking re-renders during streaming because:
1. The AI SDK mutates the messages array in place
2. `equal()` deep equality check doesn't detect mutations
3. Messages component returns `true` and skips re-render
4. PreviewMessage never gets updated props

## Solution

Disable memoization in Messages component during streaming, just like PreviewMessage:

```typescript
export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  // Always re-render during streaming
  if (prevProps.status === 'streaming' || nextProps.status === 'streaming') {
    return false;
  }

  if (prevProps.selectedModelId !== nextProps.selectedModelId) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  if (!equal(prevProps.feedback, nextProps.feedback)) return false;

  return true; // Props are equal, skip re-render
});
```

## Test Results

### Feedback Branch in Ephemeral Mode
❌ **CONFIRMED** - Streaming still doesn't work in ephemeral mode

This confirms the issue is **memo-related, NOT database-related**. The nested memo in Messages component is blocking re-renders regardless of whether the database is enabled.

### E2E Test Script
✅ **PASSED** - All 7 test scenarios passed:
- Session verification
- Chat creation with streaming
- Message retrieval
- Feedback submission (thumbs up)
- Feedback verification
- Feedback update (thumbs down)
- Chat history retrieval

Backend functionality is working correctly. The issue is purely in the React rendering layer.

## Next Steps

1. ✅ Document findings (this file)
2. ✅ Test feedback branch in ephemeral mode to isolate DB vs memo issue
3. ⏳ Apply fix to Messages component memo function
4. ⏳ Verify streaming works with fix applied
5. ⏳ Test that memoization still works for non-streaming scenarios

## Notes

- Database mode vs ephemeral mode is unlikely to affect rendering
- The issue is purely in React component memoization logic
- The fix I applied to PreviewMessage was correct but incomplete
- Need to apply the same pattern to the parent Messages component
