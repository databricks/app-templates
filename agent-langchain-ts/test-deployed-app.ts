/**
 * Test script for deployed Databricks App
 * Validates both /invocations and /api/chat endpoints work in production
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const APP_URL = "https://agent-lc-ts-dev-6051921418418893.staging.aws.databricksapps.com";

async function getAuthToken(): Promise<string> {
  console.log("🔑 Getting OAuth token...");
  try {
    const { stdout } = await execAsync("databricks auth token --profile dogfood");
    const tokenData = JSON.parse(stdout.trim());
    return tokenData.access_token;
  } catch (error) {
    throw new Error(`Failed to get auth token: ${error}`);
  }
}

async function testInvocations(token: string) {
  console.log("\n=== Testing /invocations (Responses API) ===");

  const response = await fetch(`${APP_URL}/invocations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [
        {
          role: "user",
          content: "Say exactly: Deployed invocations test successful",
        },
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  console.log("✅ Response received");
  const text = await response.text();

  // Parse SSE stream
  let fullOutput = "";
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "response.output_text.delta") {
          fullOutput += data.delta;
          process.stdout.write(data.delta);
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  console.log("\n");
  const hasContent = fullOutput.toLowerCase().includes("deployed") &&
                     fullOutput.toLowerCase().includes("successful");

  console.log(`✅ /invocations test: ${hasContent ? "PASS" : "FAIL"}`);
  return hasContent;
}

async function testApiChat(token: string) {
  console.log("\n=== Testing /api/chat (useChat format) ===");

  const response = await fetch(`${APP_URL}/api/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: "550e8400-e29b-41d4-a716-446655440000",
      message: {
        role: "user",
        parts: [
          {
            type: "text",
            text: "Say exactly: Deployed useChat test successful",
          },
        ],
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

  console.log("✅ Response received");
  const text = await response.text();

  // Parse SSE stream
  let fullContent = "";
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "text-delta") {
          fullContent += data.delta;
          process.stdout.write(data.delta);
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  console.log("\n");
  const hasContent = fullContent.toLowerCase().includes("deployed") &&
                     fullContent.toLowerCase().includes("successful");

  console.log(`✅ /api/chat test: ${hasContent ? "PASS" : "FAIL"}`);
  return hasContent;
}

async function testToolCalling(token: string) {
  console.log("\n=== Testing Tool Calling via /invocations ===");

  const response = await fetch(`${APP_URL}/invocations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [
        {
          role: "user",
          content: "Calculate 123 * 456",
        },
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  console.log("✅ Response received");
  const text = await response.text();

  // Parse SSE stream
  let fullOutput = "";
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "response.output_text.delta") {
          fullOutput += data.delta;
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  console.log(`Response: ${fullOutput}`);
  const hasResult = fullOutput.includes("56088") || fullOutput.includes("56,088");

  console.log(`✅ Tool calling test: ${hasResult ? "PASS" : "FAIL"}`);
  return hasResult;
}

async function main() {
  console.log(`🚀 Testing deployed app at: ${APP_URL}\n`);

  try {
    const token = await getAuthToken();

    // Test 1: /invocations endpoint
    const test1 = await testInvocations(token);

    // Test 2: /api/chat endpoint
    const test2 = await testApiChat(token);

    // Test 3: Tool calling
    const test3 = await testToolCalling(token);

    console.log("\n=== RESULTS ===");
    console.log(`${test1 ? "✅" : "❌"} /invocations (Responses API): ${test1 ? "PASS" : "FAIL"}`);
    console.log(`${test2 ? "✅" : "❌"} /api/chat (useChat format): ${test2 ? "PASS" : "FAIL"}`);
    console.log(`${test3 ? "✅" : "❌"} Tool calling: ${test3 ? "PASS" : "FAIL"}`);

    if (test1 && test2 && test3) {
      console.log("\n🎉 All deployed app tests passed!");
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
