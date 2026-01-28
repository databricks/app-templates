# Trace ID Support Investigation

## Goal
Enable feedback submission on MLflow traces (not just messages) by retrieving trace IDs from agent serving endpoint responses.

## Background

According to Databricks documentation:
- Agent serving endpoints support `databricks_options.return_trace` parameter
- When set to `true`, the response includes trace_id and span_id
- These can be used to log feedback to MLflow using the trace_id

**References:**
- [Query a deployed Mosaic AI agent](https://docs.databricks.com/aws/en/generative-ai/agent-framework/query-agent)
- [Trace agents deployed on Databricks](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/prod-tracing)
- [Collect user feedback](https://docs.databricks.com/aws/en/mlflow3/genai/tracing/collect-user-feedback)

## Current Implementation

### Current Flow
1. **Client** sends message via `/api/chat` POST request
2. **Server** (`server/src/routes/chat.ts:219-228`) calls `streamText()`:
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
3. **Provider** (`packages/ai-sdk-providers/src/providers-server.ts`) makes request via `databricksFetch()`
4. **Response** is streamed back via SSE
5. **Feedback** is stored with `messageId` used as placeholder for `trace_id` (`server/src/utils/mlflow-client.ts:61`)

### Current Limitation
The current implementation uses `messageId` as the `trace_id` when submitting feedback to MLflow (see `server/src/utils/mlflow-client.ts:61`), which is a workaround. Real trace IDs are not extracted from agent responses.

## Investigation Findings

### 1. Databricks Documentation Shows `extra_body` Parameter

Example from Python SDK:
```python
streaming_response = client.responses.create(
    model=endpoint,
    input=input_msgs,
    stream=True,
    extra_body={
        "databricks_options": {"return_trace": True},
    },
)
```

### 2. Vercel AI SDK Provider Options

The Vercel AI SDK supports passing provider-specific options via:
- `providerOptions` parameter in `streamText()` call (per-request)
- `extraBody` in provider factory (model-level defaults)

**Reference:** [AI SDK Core: streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)

### 3. Databricks AI SDK Provider Analysis

**Package:** `@databricks/ai-sdk-provider` v0.2.1

**Location:** `node_modules/@databricks/ai-sdk-provider/`

**Current Request Body Structure** (from `dist/index.cjs:1360-1367`):
```javascript
body: {
  model: modelId,
  input,
  stream,
  ...tools ? { tools } : {},
  ...toolChoice && tools ? { tool_choice: toolChoice } : {}
}
```

**Key Finding:** The current version (0.2.1) does NOT support:
- ✗ `providerOptions` at request level
- ✗ `extra_body` or `extraBody` parameter
- ✗ `databricks_options` passthrough

The provider ONLY uses `providerOptions` for tool metadata (MCP approval workflow), not for request-level options.

## Proposed Solutions

### Option 1: Fork/Patch Databricks AI SDK Provider (Not Recommended)
- Modify the provider to accept `providerOptions.databricks_options` and merge into request body
- Requires maintaining a fork or monkey-patching

### Option 2: Use Custom Fetch to Modify Requests (Hacky)
- Intercept requests in `databricksFetch()` and inject `databricks_options`
- Parse request body, add options, stringify again
- Would work but fragile

### Option 3: Extract Trace ID from Response Headers (If Available)
- Check if trace IDs are returned in response headers (e.g., `X-Databricks-Trace-Id`)
- Modify `databricksFetch()` to capture and propagate trace IDs
- Pass trace ID through streaming response metadata

### Option 4: Request Feature in Databricks AI SDK Provider (Recommended)
- File issue/PR in [databricks-ai-bridge](https://github.com/databricks/databricks-ai-bridge) repo
- Request support for `providerOptions` forwarding to request body
- Wait for new version with feature

### Option 5: Use OpenAI-Compatible API Directly (Workaround)
- Bypass the Databricks provider
- Use OpenAI provider with custom `baseURL` pointing to Databricks
- Manually construct requests with `extra_body`
- Lose Databricks-specific features (MCP approval, tool metadata)

## Recommendation

**Short-term:** Check if trace IDs are returned in response headers (Option 3). If yes, extract and use them.

**Long-term:** File feature request with Databricks (Option 4) to add proper `providerOptions` support for `databricks_options`.

## Next Steps

1. ✅ Document current state and limitations
2. ⏳ Test if trace IDs are in response headers
3. ⏳ If headers contain trace ID, implement extraction in `databricksFetch()`
4. ⏳ Update MLflow client to use real trace IDs instead of messageId
5. ⏳ File feature request with Databricks AI SDK provider team

## Testing Plan

To test if trace IDs are in headers:
1. Enable SSE logging: `LOG_SSE_EVENTS=true npm run dev`
2. Send a message through the chat interface
3. Check server logs for response headers
4. Look for headers like:
   - `x-databricks-trace-id`
   - `x-mlflow-trace-id`
   - `mlflow-trace-id`
   - Or trace ID in SSE event metadata

## Code References

- **Request construction:** `packages/ai-sdk-providers/src/providers-server.ts:186-196`
- **Fetch wrapper:** `packages/ai-sdk-providers/src/providers-server.ts:70-156`
- **Chat route:** `server/src/routes/chat.ts:219-228`
- **MLflow client:** `server/src/utils/mlflow-client.ts:61` (uses messageId as trace_id)
- **Feedback submission:** `server/src/routes/feedback.ts`
