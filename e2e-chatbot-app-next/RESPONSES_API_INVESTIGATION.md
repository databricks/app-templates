# Responses API /invocations Endpoint Investigation

## Executive Summary

**Feasibility**: ✅ **VIABLE** - All required pieces exist and can be integrated

**Benefits**:
1. MLflow-compatible `/invocations` endpoint for external clients
2. Reuses well-tested conversion logic on both ends
3. Cleaner architecture with standard interfaces

## Current Architecture

```
Frontend (useChat)
  ↓
Backend (/api/chat)
  ↓
LangChain agent.streamEvents()
  ↓
[Manual conversion to AI SDK chunks]
  ↓
Frontend renders (Tool + ToolHeader + ToolContent components)
```

## Proposed Architecture

```
Frontend (useChat with AI SDK provider)
  ↓
Backend (/invocations) - Responses API format
  ↓
LangChain agent.streamEvents()
  ↓
[Convert to Responses API using MLflow logic]
  ↓
AI SDK provider converts to AI SDK chunks
  ↓
Frontend renders (dynamic-tool parts)
```

## Key Findings

### 1. MLflow LangChain → Responses API Conversion

**Location**: `~/mlflow/mlflow/types/responses.py`

**Function**: `_langchain_message_stream_to_responses_stream()`

**Logic**:
```python
# For LangChain BaseMessage objects:
- AIMessage with content → create_text_output_item()
  → emit ResponsesAgentStreamEvent(type="response.output_item.done", item=text_output_item)

- AIMessage with tool_calls → create_function_call_item() for each call
  → emit ResponsesAgentStreamEvent(type="response.output_item.done", item=function_call_item)

- ToolMessage → create_function_call_output_item()
  → emit ResponsesAgentStreamEvent(type="response.output_item.done", item=function_call_output_item)
```

### 2. Responses API Format

**Stream Events**:
- `response.output_text.delta` - Text streaming chunks
- `response.output_item.done` - Completed items (text, function calls, function outputs)
- `response.completed` - Stream completion
- `error` - Error events

**Example Text Delta**:
```json
{
  "type": "response.output_text.delta",
  "item_id": "msg-123",
  "delta": "Hello "
}
```

**Example Function Call Item**:
```json
{
  "type": "function_call",
  "id": "item-123",
  "call_id": "call-456",
  "name": "get_current_time",
  "arguments": "{\"timezone\":\"Asia/Tokyo\"}"
}
```

**Example Function Output**:
```json
{
  "type": "function_call_output",
  "call_id": "call-456",
  "output": "Current time: 12:00 PM"
}
```

### 3. AI SDK Provider Conversion

**Location**: `~/databricks-ai-bridge/integrations/ai-sdk-provider/src/responses-agent-language-model/responses-convert-to-message-parts.ts`

**Function**: `convertResponsesAgentChunkToMessagePart()`

**Logic**:
```typescript
switch (chunk.type) {
  case 'response.output_text.delta':
    // Emit text-start for new items, then text-delta
    return [{ type: 'text-start', id: chunk.item_id }, { type: 'text-delta', delta: chunk.delta }]

  case 'response.output_item.done':
    if (item.type === 'function_call') {
      // Convert to tool-input-start, tool-input-available
    }
    if (item.type === 'function_call_output') {
      // Convert to tool-output-available
    }
    if (item.type === 'message') {
      // Convert to text parts
    }
}
```

## Implementation Plan

### Phase 1: Create /invocations Endpoint

1. Port MLflow conversion logic to TypeScript
2. Create `/invocations` endpoint that:
   - Accepts Responses API request format
   - Runs LangChain agent
   - Converts events to Responses API format
   - Streams SSE events

### Phase 2: Update Frontend

1. Configure AI SDK provider to use local endpoint:
   ```typescript
   const model = createDatabricksProvider({
     baseURL: 'http://localhost:5001',
     fetch: customFetch
   })('invocations')
   ```

2. Update chat route to use provider model instead of custom streaming

### Phase 3: Test & Validate

1. Test `/invocations` with curl (like Python agents)
2. Test frontend rendering with provider
3. Verify external clients can consume endpoint

## TypeScript Conversion Helpers Needed

Based on MLflow Python code, we need these helpers:

```typescript
// Create Responses API items
function createTextOutputItem(text: string, id: string): OutputItem
function createFunctionCallItem(id: string, callId: string, name: string, args: string): OutputItem
function createFunctionCallOutputItem(callId: string, output: string): OutputItem
function createTextDelta(delta: string, itemId: string): ResponsesAgentStreamEvent

// Convert LangChain messages to Responses API
function langchainMessageToResponsesItem(message: BaseMessage): OutputItem[]
function langchainStreamToResponsesStream(
  events: AsyncIterator<LangChainEvent>
): AsyncGenerator<ResponsesAgentStreamEvent>
```

## Testing Strategy

1. **Unit Tests**: Test conversion functions with LangChain messages
2. **Integration Test**: curl → /invocations → verify Responses API format
3. **E2E Test**: Frontend → /invocations → verify rendering with AI SDK provider
4. **External Client Test**: External app queries /invocations

## Risks & Mitigations

### Risk 1: TypeScript Conversion Accuracy
**Mitigation**: Port logic directly from MLflow, add comprehensive tests

### Risk 2: AI SDK Provider Compatibility
**Mitigation**: Provider already handles Responses API, just need correct endpoint config

### Risk 3: Performance Overhead
**Mitigation**: No significant overhead - just format conversion, no additional API calls

## Next Steps

1. ✅ Create branch: `responses-api-invocations`
2. ⬜ Implement TypeScript conversion helpers
3. ⬜ Create `/invocations` endpoint
4. ⬜ Test endpoint with curl
5. ⬜ Update frontend to use provider
6. ⬜ Test end-to-end
7. ⬜ Document findings and trade-offs

## Open Questions

1. Should we keep both `/api/chat` and `/invocations` or replace entirely?
   - **Recommendation**: Keep both - `/invocations` for MLflow compatibility, `/api/chat` for custom logic

2. How to handle authentication for `/invocations`?
   - **Recommendation**: Same header-based auth as current implementation

3. Should we support both streaming and non-streaming?
   - **Recommendation**: Yes, both modes like Python AgentServer

## References

- [MLflow Responses Agent Docs](https://mlflow.org/docs/latest/genai/serving/responses-agent/)
- [Databricks AI SDK Provider](https://github.com/databricks/databricks-ai-bridge/tree/main/integrations/ai-sdk-provider)
- [MLflow Conversion Logic](~/mlflow/mlflow/types/responses.py)
