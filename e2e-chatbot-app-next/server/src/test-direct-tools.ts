/**
 * Test script to verify tool calling with ChatDatabricks
 * Tests if useRemoteToolCalling configuration affects tool calling behavior
 */

import { ChatDatabricks } from "@databricks/langchainjs";
import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

// Create a simple time tool
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

async function testDirectToolCall() {
  console.log("🧪 Testing direct ChatDatabricks tool calling\n");

  const model = new ChatDatabricks({
    model: process.env.DATABRICKS_SERVING_ENDPOINT || "databricks-claude-sonnet-4-5",
    useResponsesApi: false,
    temperature: 0.1,
    maxTokens: 500,
  });

  console.log("Model configuration:");
  console.log(`  model: ${process.env.DATABRICKS_SERVING_ENDPOINT || "databricks-claude-sonnet-4-5"}`);
  console.log(`  useResponsesApi: false`);
  console.log();

  // Bind the tool to the model
  const modelWithTools = model.bindTools([timeTool]);

  console.log("✅ Bound tool: get_current_time\n");

  const testQuery = "What time is it in Tokyo right now?";
  console.log(`📝 Query: ${testQuery}\n`);

  try {
    const response = await modelWithTools.invoke(testQuery);

    console.log("Response:");
    console.log(`  content: ${response.content}`);
    console.log(`  tool_calls: ${JSON.stringify(response.tool_calls, null, 2)}`);

    if (response.tool_calls && response.tool_calls.length > 0) {
      console.log("\n✅ SUCCESS: Model made tool calls!");

      // Execute the tool
      for (const toolCall of response.tool_calls) {
        console.log(`\n🔧 Executing tool: ${toolCall.name}`);
        console.log(`   Args: ${JSON.stringify(toolCall.args)}`);

        const result = await timeTool.invoke(toolCall.args);
        console.log(`   Result: ${result}`);
      }
    } else {
      console.log("\n❌ FAILURE: Model did not make any tool calls");
      console.log("   This confirms the useRemoteToolCalling issue");
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Run the test
testDirectToolCall().catch(console.error);
