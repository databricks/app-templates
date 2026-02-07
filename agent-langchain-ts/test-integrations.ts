/**
 * Manual integration test to verify both endpoints work
 */

import { createDatabricksProvider } from "@databricks/ai-sdk-provider";
import { streamText } from "ai";

async function testInvocations() {
  console.log("\n=== Testing /invocations with Databricks AI SDK Provider ===");

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
    messages: [
      { role: "user", content: "Say exactly: Databricks provider test successful" },
    ],
  });

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
    process.stdout.write(chunk);
  }

  console.log("\n\n✅ /invocations test passed!");
  console.log(`Response: ${fullText}`);

  return fullText.toLowerCase().includes("databricks") || fullText.toLowerCase().includes("successful");
}

async function testApiChat() {
  console.log("\n=== Testing /api/chat with useChat format ===");

  const response = await fetch("http://localhost:3001/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "550e8400-e29b-41d4-a716-446655440000",
      message: {
        role: "user",
        parts: [{ type: "text", text: "Say exactly: useChat test successful" }],
        id: "550e8400-e29b-41d4-a716-446655440001",
      },
      selectedChatModel: "chat-model",
      selectedVisibilityType: "private",
      nextMessageId: "550e8400-e29b-41d4-a716-446655440002",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const text = await response.text();
  console.log("Response stream (first 500 chars):");
  console.log(text.substring(0, 500));

  // Parse text deltas to check full content
  const lines = text.split("\n");
  let fullContent = "";
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "text-delta") {
          fullContent += data.delta;
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  // Check for Databricks SSE format (used by createUIMessageStream)
  const hasSSEFormat = text.includes('data: {"type"');
  const hasTextDelta = text.includes('"type":"text-delta"');
  const hasContent = fullContent.toLowerCase().includes("usechat") && fullContent.toLowerCase().includes("successful");

  console.log("\n✅ /api/chat test passed!");
  console.log(`Has SSE format: ${hasSSEFormat}`);
  console.log(`Has text-delta events: ${hasTextDelta}`);
  console.log(`Full content assembled: "${fullContent}"`);
  console.log(`Has expected content: ${hasContent}`);

  return hasSSEFormat && hasTextDelta && hasContent;
}

async function main() {
  try {
    // Test 1: /invocations with Databricks AI SDK provider
    const test1 = await testInvocations();

    // Test 2: /api/chat with useChat format
    const test2 = await testApiChat();

    console.log("\n=== RESULTS ===");
    console.log(`✅ /invocations (Databricks AI SDK provider): ${test1 ? "PASS" : "FAIL"}`);
    console.log(`✅ /api/chat (useChat format): ${test2 ? "PASS" : "FAIL"}`);

    if (test1 && test2) {
      console.log("\n🎉 All integrations validated successfully!");
      process.exit(0);
    } else {
      console.log("\n❌ Some tests failed");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

main();
