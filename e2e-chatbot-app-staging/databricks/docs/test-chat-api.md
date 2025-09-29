# Testing the Chat API

## Prerequisites

1. Start the development server: `npm run dev`
2. Create authentication cookies by visiting `http://localhost:3003/api/auth/guest` in your browser or running:
   ```bash
   curl -L -c cookies.txt http://localhost:3003/api/auth/guest
   ```

## Test Chat API

Use this cURL command to test the chat API:

```bash
curl -X POST http://localhost:3003/api/chat \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "message": {
      "id": "123e4567-e89b-12d3-a456-426614174001",
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "Hello, can you help me with a simple question?"
        }
      ]
    },
    "selectedChatModel": "chat-model",
    "selectedVisibilityType": "private"
  }'
```

## Expected Response

You should see a streaming response that starts with:
```
data: {"type":"start","messageId":"..."}
```

And ends with:
```
data: [DONE]
```

## Databricks Integration

This API now uses the Databricks agent serving endpoint:
- **Endpoint**: `https://e2-dogfood.staging.cloud.databricks.com/serving-endpoints/responses`
- **Model**: `ka-1e3e7f9e-endpoint`
- **Authentication**: Uses `DATABRICKS_TOKEN` environment variable

### Key Implementation Details

✅ **Working Features:**
- URL rewriting from `/responses/responses` to `/serving-endpoints/responses`
- Content format transformation (complex array → simple string)
- Response format compatibility with AI SDK
- Custom fetch function with proper error handling

✅ **Content Format Fix:**
The AI SDK sends content in this format:
```json
{"content": [{"type": "input_text", "text": "Hello"}]}
```

But Databricks expects:
```json
{"content": "Hello"}
```

Our custom fetch function automatically converts between these formats.

## Direct Test Endpoint

For testing without database dependencies:
```bash
curl -X POST http://localhost:3003/api/test-direct \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "input": [
      {
        "role": "user",
        "content": "What is 2+2?"
      }
    ]
  }'
```

## Troubleshooting

- If you get authentication errors, make sure the cookies.txt file was created properly
- If you get database errors, the Databricks integration is likely working but there's a separate database issue
- The test endpoint (`/api/test-direct`) bypasses database saves for pure AI testing
- Check the server logs for detailed error information