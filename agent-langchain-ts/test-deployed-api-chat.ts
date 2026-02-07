/**
 * Test /api/chat endpoint on deployed app
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const APP_URL = "https://agent-lc-ts-dev-6051921418418893.staging.aws.databricksapps.com";

async function getAuthToken(): Promise<string> {
  const { stdout } = await execAsync("databricks auth token --profile dogfood");
  const tokenData = JSON.parse(stdout.trim());
  return tokenData.access_token;
}

async function main() {
  console.log(`🚀 Testing /api/chat on: ${APP_URL}\n`);

  try {
    const token = await getAuthToken();
    console.log("✅ Got auth token\n");

    console.log("=== Testing /api/chat (useChat format) ===");
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
            { type: "text", text: "Say exactly: Deployed test successful" },
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

    console.log("✅ Response received, streaming content:\n");
    const text = await response.text();

    console.log("Raw response (first 1000 chars):");
    console.log(text.substring(0, 1000));
    console.log("\n");

    // Parse SSE stream
    let fullContent = "";
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          console.log("Event:", data.type);
          if (data.type === "text-delta") {
            fullContent += data.delta;
            process.stdout.write(data.delta);
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    console.log("\n\n✅ Test complete!");
    console.log(`Full response: ${fullContent}`);

    // Check if response contains expected text
    const hasResult = fullContent.toLowerCase().includes("deployed") && fullContent.toLowerCase().includes("successful");
    console.log(`\n${hasResult ? "✅" : "❌"} Expected content found: ${hasResult}`);

    process.exit(hasResult ? 0 : 1);
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

main();
