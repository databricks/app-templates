## Databricks chunk transformers

These transformers adapt streaming output from Databricks Agent endpoints into `LanguageModelV2StreamPart` objects that `@ai-sdk` understands. In short: they normalize Databricks agent events (text, tool calls, etc.) into a consistent stream the rest of the app can consume.

### What they do

- **Normalize Databricks agent events** into `LanguageModelV2StreamPart` variants (e.g., text deltas, tool calls, tool results).
- **Bridge protocols** so downstream UI and logic can rely on a single stream format regardless of the model/provider specifics.

### Files

- `databricks-raw-chunk-transformer.ts`: Low-level adapter that parses raw chunks from the Databricks agent stream into typed events.
- `databricks-stream-part-transformers.ts`: Maps Databricks events into `LanguageModelV2StreamPart` objects expected by `@ai-sdk`.
- `databricks-text-parts.ts`: Helpers for converting text-like segments (message content, reasoning, citations) into the correct stream parts.
- `databricks-tool-calling.ts`: Maps tool call/request and tool result events to the `@ai-sdk` tool-calling stream parts.

### When to use

Use these transformers anywhere you consume a Databricks Agent streaming response and need to surface it through the standard `@ai-sdk` streaming interfaces (e.g., API routes or server components that pipe model output to the client).

### Minimal usage sketch

```ts
// Pseudocode — actual function names may differ
import { transformDatabricksStream } from "./databricks-stream-part-transformers";

async function* toAiSdkParts(databricksResponse: Response) {
  const reader = databricksResponse.body!.getReader();
  for await (const part of transformDatabricksStream(reader)) {
    // `part` is a LanguageModelV2StreamPart that @ai-sdk can handle
    yield part;
  }
}
```

The rest of the application can then consume `LanguageModelV2StreamPart` values uniformly, independent of Databricks-specific response shapes.
