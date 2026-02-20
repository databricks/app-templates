# Testing Workflow

Always test in this order for best results:

## 1. Test Agent Endpoint Directly

Test `/invocations` endpoint (simplest, fastest feedback):

```bash
# Start agent
npm run dev:agent

# Test with curl
curl -X POST http://localhost:5001/invocations \
  -H "Content-Type: application/json" \
  -d '{
    "input": [{"role": "user", "content": "What time is it in Tokyo?"}],
    "stream": true
  }'
```

## 2. Test UI Integration

Test `/api/chat` via UI:

```bash
# Start both servers
npm run dev

# Open browser
open http://localhost:3000
```

## 3. Run Automated Tests

```bash
npm run test:all              # All tests
npm run test:unit             # Agent unit tests
npm run test:integration      # Local endpoint tests
npm run test:error-handling   # Error scenarios
```

## 4. Test Deployed App

```bash
# Get app URL
databricks apps get <app-name> --output json | jq -r '.url'

# Run deployed tests
APP_URL=<app-url> npm run test:deployed
```

## Test with TypeScript

```typescript
import { createDatabricksProvider } from "@databricks/ai-sdk-provider";
import { streamText } from "ai";

const databricks = createDatabricksProvider({
  baseURL: "http://localhost:5001",
  formatUrl: ({ baseUrl, path }) => {
    if (path === "/responses") {
      return `${baseUrl}/invocations`;
    }
    return `${baseUrl}${path}`;
  },
});

const result = streamText({
  model: databricks.responses("test-model"),
  messages: [{ role: "user", content: "Calculate 123 * 456" }],
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```
