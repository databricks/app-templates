# Tool Execution Debugging: Server-Side Tool Results Not Captured

## Problem Statement

The Databricks agent backend successfully executes server-side tools (like `system__ai__python_exec`), but the tool results are not being properly captured in the conversation history. Instead, they get replaced with error messages like "Model tried to call unavailable tool 'system__ai__python_exec'. No tools are available."

## Root Cause Analysis

### What We Know Works ✅

1. **Databricks Agent Execution**: The agent backend correctly executes tools and returns results
2. **Tool Call Detection**: The `tool-call` chunks are properly received and processed
3. **Raw Tool Results**: The `function_call_output` chunks are being sent by Databricks

### What's Broken ❌

**The AI SDK is not parsing `function_call_output` chunks from Databricks responses API format.**

### Evidence from Logs

```bash
# ✅ Tool call is received correctly
databricksMiddleware incoming chunk {
  type: 'tool-call',
  toolCallId: 'toolu_bdrk_017X5q3GGeJxjsnZeSR8zvsS',
  toolName: 'system__ai__python_exec',
  input: '{"code": "# Calculate the 100th Fibonacci number..."}',
  providerMetadata: { openai: { itemId: 'msg_bdrk_01XZKCXvCrMicqpbpDCE9gsS' } }
}

# ✅ Raw Databricks response contains the tool result
🔍 RAW DATABRICKS CHUNK: {
  "type": "response.output_item.done",
  "item": {
    "type": "function_call_output",
    "call_id": "toolu_bdrk_017X5q3GGeJxjsnZeSR8zvsS",
    "output": "The 100th Fibonacci number is: 354224848179261915075\n"
  },
  "id": "218a0ac6-605f-409a-9ad7-067b49499263"
}

# ✅ Tool result is detected in raw logging
✅ FOUND function_call_output: The 100th Fibonacci number is: 354224848179261915075

# ❌ But only text-delta chunks make it through the middleware
databricksMiddleware incoming chunk {
  type: 'text-delta',
  id: 'msg_bdrk_01J4qdJZTcKEdmJ8Q2cqS412',
  delta: 'The 100'
}
```

## Technical Analysis

### Format Mismatch Issue

**Databricks Responses API Format:**
```json
{
  "type": "response.output_item.done",
  "item": {
    "type": "function_call_output",
    "call_id": "toolu_bdrk_017X5q3GGeJxjsnZeSR8zvsS",
    "output": "The 100th Fibonacci number is: 354224848179261915075\n"
  }
}
```

**AI SDK Expected Format:**
The AI SDK expects OpenAI chat completions streaming format, not Databricks responses API format.

### Data Flow

1. **Databricks Agent** → Executes tool successfully
2. **Databricks Responses API** → Sends `function_call_output` in responses format
3. **databricksFetch** → Passes through raw chunks unchanged
4. **AI SDK Parser** → Only recognizes OpenAI format, ignores `function_call_output`
5. **databricksMiddleware** → Only sees `text-delta` chunks, missing tool results
6. **Conversation History** → Contains tool calls but no results → validation errors

## Failed Approaches

### ❌ Attempt 1: Strip Server-Side Tools
- **Approach**: Filter out server-side tool calls from conversation history
- **Result**: Tool calls work but results aren't preserved for context

### ❌ Attempt 2: Transform All Chunks to OpenAI Format
- **Approach**: Convert all Databricks chunks to chat completions format
- **Result**: Schema validation errors from AI SDK expecting responses format

### ❌ Attempt 3: Middleware Tool Result Generation
- **Approach**: Generate tool results in middleware based on text patterns
- **Result**: Unreliable and doesn't capture actual tool output

## Proposed Solution

**Transform only tool-related chunks to AI SDK compatible format while preserving responses API format for other chunks.**

### Implementation Strategy

1. **Selective Transformation**: Only transform `function_call_output` chunks
2. **Preserve Format**: Keep other chunks in Databricks responses API format
3. **AI SDK Compatibility**: Ensure tool results are in expected format

### Code Changes Needed

In `lib/ai/providers.ts` - `databricksFetch` function:

```typescript
// Handle streaming responses - selective transformation
if (contentType?.includes('text/event-stream')) {
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk);
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          const eventData = JSON.parse(line.slice(6));

          // Transform only function_call_output to tool-result format
          if (eventData.item?.type === 'function_call_output') {
            const toolResult = {
              type: 'tool-result',
              toolCallId: eventData.item.call_id,
              result: eventData.item.output,
              // ... other required fields
            };
            const transformedLine = `data: ${JSON.stringify(toolResult)}\n\n`;
            controller.enqueue(new TextEncoder().encode(transformedLine));
            continue;
          }
        }

        // Pass through all other chunks unchanged
        controller.enqueue(chunk);
      }
    }
  });
}
```

## Files Involved

- `lib/ai/providers.ts` - Main transformation logic
- `app/(chat)/api/chat/route.ts` - Chat API endpoint
- `components/message.tsx` - Tool call rendering (already supports generic tools)

## Next Steps

1. Implement selective chunk transformation for `function_call_output`
2. Test with server-side tool execution
3. Verify conversation history preservation
4. Remove debug logging once confirmed working

## Testing

To test the fix:
1. Start dev server: `npm run dev`
2. Open http://localhost:3000
3. Ask: "Calculate the 100th Fibonacci number in Python"
4. Verify tool result is preserved in conversation history
5. Ask follow-up question to confirm context is maintained