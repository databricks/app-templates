# Trace ID Implementation for API_PROXY (Agents on Apps)

## Overview

For custom agents on Databricks Apps (when `API_PROXY` env var is set), trace IDs can be requested via the `X-Mlflow-Return-Trace: true` header.

## Implementation Approach

### 1. Add Header in Custom Fetch (EASY ✅)

**File:** `packages/ai-sdk-providers/src/providers-server.ts`

**Current code (lines 186-196):**
```typescript
fetch: async (...[input, init]: Parameters<typeof fetch>) => {
  // Always get fresh token for each request (will use cache if valid)
  const currentToken = await getProviderToken();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${currentToken}`);

  return databricksFetch(input, {
    ...init,
    headers,
  });
},
```

**Modified code:**
```typescript
fetch: async (...[input, init]: Parameters<typeof fetch>) => {
  // Always get fresh token for each request (will use cache if valid)
  const currentToken = await getProviderToken();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${currentToken}`);

  // Request trace ID for API_PROXY agents
  if (API_PROXY) {
    headers.set('X-Mlflow-Return-Trace', 'true');
  }

  return databricksFetch(input, {
    ...init,
    headers,
  });
},
```

**That's it for adding the header!** Very simple because we already have the custom fetch wrapper.

### 2. Extract Trace ID from Response

The trace ID will be returned in the response. There are two possible locations:

#### Option A: Response Headers
If trace ID is in response headers (e.g., `X-Mlflow-Trace-Id`), we can extract it in `databricksFetch()`:

```typescript
export const databricksFetch: typeof fetch = async (input, init) => {
  const url = input.toString();

  // ... existing logging ...

  const response = await fetch(url, init);

  // Extract trace ID from response headers if present
  const traceId = response.headers.get('X-Mlflow-Trace-Id') ||
                  response.headers.get('x-mlflow-trace-id');

  if (traceId) {
    console.log('[Trace] Received trace ID:', traceId);
    // Store trace ID for later use - need to associate with request
  }

  // ... existing SSE logging ...

  return response;
};
```

#### Option B: Response Body
If trace ID is in the response body (JSON field), it will be automatically available in the AI SDK's response object.

For the Databricks Responses API, the response format is:
```json
{
  "choices": [...],
  "trace_id": "abc123",  // ← Here if return_trace is enabled
  "span_id": "xyz789"
}
```

The AI SDK parses this and makes it available via `rawResponse` in callbacks.

### 3. Propagate Trace ID to Message Saving

The challenge is associating the trace ID with the specific message. Here are the options:

#### Option 1: Use AI SDK's `onFinish` Callback (RECOMMENDED ✅)

The `streamText()` onFinish callback receives `rawResponse` which includes the full response:

**File:** `server/src/routes/chat.ts`

**Current code (line 219-228):**
```typescript
const result = streamText({
  model,
  messages: convertToModelMessages(uiMessages),
  onFinish: ({ usage }) => {
    finalUsage = usage;
  },
  tools: {
    [DATABRICKS_TOOL_CALL_ID]: DATABRICKS_TOOL_DEFINITION,
  },
});
```

**Modified code:**
```typescript
let responseTraceId: string | undefined;

const result = streamText({
  model,
  messages: convertToModelMessages(uiMessages),
  onFinish: ({ usage, rawResponse }) => {
    finalUsage = usage;

    // Extract trace ID from response
    if (rawResponse?.headers) {
      responseTraceId = rawResponse.headers['x-mlflow-trace-id'] ||
                       rawResponse.headers['X-Mlflow-Trace-Id'];
      console.log('[Trace] Extracted trace ID from headers:', responseTraceId);
    }

    // Or from response body if available
    if (!responseTraceId && (rawResponse as any)?.trace_id) {
      responseTraceId = (rawResponse as any).trace_id;
      console.log('[Trace] Extracted trace ID from body:', responseTraceId);
    }
  },
  tools: {
    [DATABRICKS_TOOL_CALL_ID]: DATABRICKS_TOOL_DEFINITION,
  },
});
```

Then pass `responseTraceId` when saving the message (line 255-271):

```typescript
onFinish: async ({ responseMessage }) => {
  console.log('Finished message stream! Saving message...');
  await saveMessages({
    messages: [
      {
        id: responseMessage.id,
        role: responseMessage.role,
        parts: responseMessage.parts,
        createdAt: new Date(),
        attachments: [],
        chatId: id,
        metadata: {
          traceId: responseTraceId, // ← Add trace ID here
        },
      },
    ],
  });

  // ... rest of onFinish ...
},
```

#### Option 2: Store in Thread-Local Context

Use a Map to associate request IDs with trace IDs:

```typescript
// At module level
const traceIdMap = new Map<string, string>();

// In streamText onFinish
onFinish: ({ rawResponse }) => {
  const traceId = extractTraceId(rawResponse);
  if (traceId) {
    traceIdMap.set(responseMessage.id, traceId);
  }
}

// In createUIMessageStream onFinish
onFinish: async ({ responseMessage }) => {
  const traceId = traceIdMap.get(responseMessage.id);
  // ... save message with traceId ...
  traceIdMap.delete(responseMessage.id); // Clean up
}
```

### 4. Update Database Schema (if needed)

If we want to persist trace IDs in the database, we need to add a column:

**File:** `packages/db/src/schema.ts`

```typescript
export const message = pgTable('Message_v2', {
  id: uuid('id').notNull().primaryKey(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id, { onDelete: 'cascade' }),
  role: varchar('role').notNull(),
  parts: jsonb('parts').notNull(),
  createdAt: timestamp('createdAt').notNull(),
  attachments: jsonb('attachments').default([]).notNull(),

  // Add trace ID column
  traceId: varchar('traceId'), // ← New column
}, (table) => {
  return {
    chatIdCreatedAtIndex: index('chatId_createdAt_Message_v2_index').on(
      table.chatId,
      table.createdAt,
    ),
  };
});
```

Then run `npm run db:generate` to create a migration.

### 5. Update MLflow Client to Use Real Trace IDs

**File:** `server/src/utils/mlflow-client.ts`

**Current code (line 61):**
```typescript
trace_id: submission.messageId, // Using messageId as trace_id
```

**Modified code:**
```typescript
trace_id: submission.traceId || submission.messageId, // Use real trace ID if available
```

Update the `FeedbackSubmission` interface:
```typescript
interface FeedbackSubmission {
  messageId: string;
  chatId: string;
  userId: string;
  feedbackType: 'thumbs_up' | 'thumbs_down';
  assessmentId?: string;
  traceId?: string; // ← Add this field
}
```

## AI SDK Extensions Required

**Good news: NO AI SDK extensions required!** ✅

The AI SDK already provides everything we need:

1. ✅ **Custom fetch function** - We can modify headers before requests
2. ✅ **`rawResponse` in callbacks** - Access to response headers and body
3. ✅ **`onFinish` callback** - Capture metadata after streaming completes
4. ✅ **Custom metadata on messages** - Can attach arbitrary data to saved messages

The implementation is **straightforward** because:
- Headers can be added in our existing custom fetch wrapper
- Trace IDs can be extracted from `rawResponse` in `onFinish`
- No changes needed to the AI SDK or Databricks provider

## Implementation Checklist

- [ ] 1. Add `X-Mlflow-Return-Trace: true` header when API_PROXY is set
- [ ] 2. Test with API_PROXY agent to confirm trace ID is returned
- [ ] 3. Extract trace ID from `rawResponse` in `streamText.onFinish`
- [ ] 4. Store trace ID with message (either in metadata or new DB column)
- [ ] 5. Update MLflow client to use real trace IDs
- [ ] 6. Update feedback submission to pass trace ID
- [ ] 7. Test end-to-end: submit feedback → verify it appears in MLflow with correct trace

## Testing

```bash
# 1. Set API_PROXY environment variable
export API_PROXY="https://your-agent.apps.databricks.com/invocations"

# 2. Start dev server
npm run dev

# 3. Send a message and check logs for:
# - "X-Mlflow-Return-Trace: true" in request headers
# - Trace ID in response (headers or body)
# - Trace ID stored with message

# 4. Submit feedback and verify it's logged to MLflow with correct trace_id
```

## Comparison: API_PROXY vs Non-API_PROXY

| Aspect | API_PROXY (Apps) | Non-API_PROXY (Serving Endpoints) |
|--------|------------------|-----------------------------------|
| **Trace request method** | `X-Mlflow-Return-Trace: true` header | `databricks_options: {return_trace: true}` in body |
| **Implementation difficulty** | Easy ✅ (just add header) | Harder (requires body modification) |
| **AI SDK changes needed** | None ✅ | Might need provider updates |
| **Current status** | Ready to implement | Blocked by provider limitations |

## Recommendation

**For API_PROXY agents:** Implement immediately - it's straightforward and requires no AI SDK changes.

**For non-API_PROXY agents:** Wait for Databricks AI SDK provider to add support for `providerOptions` forwarding, or implement body patching workaround.
