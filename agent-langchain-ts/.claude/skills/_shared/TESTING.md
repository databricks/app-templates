# Testing Workflow

**Always run automated tests first.** Manual testing is only for debugging specific issues.

## 1. Run Automated Tests

```bash
npm run test:all              # All tests (unit + integration)
npm run test:unit             # Agent unit tests (no server needed)
npm run test:integration      # Local endpoint tests (requires servers)
npm run test:error-handling   # Error scenarios
```

## 2. Test Deployed App

```bash
# Get app URL
databricks apps get <app-name> --output json | jq -r '.url'

# Run deployed tests
APP_URL=<app-url> npm run test:deployed
```

## Manual Testing (Debugging Only)

Only use manual testing when debugging specific issues:

### Quick Agent Test (curl)

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

### UI Integration Test

```bash
# Start both servers
npm run dev

# Open browser
open http://localhost:3000
```

## Advanced: Test with TypeScript

```bash
# Get app URL
databricks apps get <app-name> --output json | jq -r '.url'

# Run deployed tests
APP_URL=<app-url> npm run test:deployed
```

## Programmatic Testing

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
