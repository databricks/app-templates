/**
 * Test script to verify tool calling works with the fixed ChatDatabricks
 */

import { ChatDatabricks } from "@databricks/langchainjs";
import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";
import "dotenv/config";

const timeTool = tool(
  async ({ timezone }) => {
    const date = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone || "UTC",
      dateStyle: "full",
      timeStyle: "long",
    };
    return date.toLocaleString("en-US", options);
  },
  {
    name: "get_current_time",
    description: "Get the current date and time in a specific timezone",
    schema: z.object({
      timezone: z.string().optional().describe("Timezone (e.g., 'America/Los_Angeles', 'Asia/Tokyo')"),
    }),
  }
);

async function testToolCalling() {
  console.log("🧪 Testing ChatDatabricks with useRemoteToolCalling fix\n");

  // Use the configured endpoint from environment
  const endpoint = process.env.DATABRICKS_SERVING_ENDPOINT || "databricks-meta-llama-3-1-70b-instruct";
  console.log(`Using endpoint: ${endpoint}`);

  const model = new ChatDatabricks({
    model: endpoint,
    useResponsesApi: false,
    temperature: 0.1,
    maxTokens: 500,
  });

  const modelWithTools = model.bindTools([timeTool]);

  console.log("✅ Bound tool: get_current_time");
  console.log(`📝 Query: "What time is it in Tokyo?"\n`);

  try {
    const response = await modelWithTools.invoke("What time is it in Tokyo?");

    console.log("📄 Response:");
    console.log(`   Content: ${response.content}`);
    console.log(`   Tool calls: ${JSON.stringify(response.tool_calls, null, 2)}`);

    if (response.tool_calls && response.tool_calls.length > 0) {
      console.log("\n✅ SUCCESS! Model made tool calls");

      // Execute the tool
      for (const toolCall of response.tool_calls) {
        console.log(`\n🔧 Executing tool: ${toolCall.name}`);
        console.log(`   Args: ${JSON.stringify(toolCall.args)}`);

        const result = await timeTool.invoke(toolCall.args);
        console.log(`   Result: ${result}`);
      }
    } else {
      console.log("\n❌ FAILURE: Model did not make any tool calls");
    }
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    if (error.message?.includes("auth")) {
      console.log("\n💡 Tip: Make sure you're authenticated with Databricks CLI:");
      console.log("   databricks auth login");
    }
  }
}

testToolCalling().catch(console.error);
