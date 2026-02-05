import { ChatDatabricks } from "@databricks/langchainjs";
import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

const timeTool = tool(
  async ({ timezone }) => {
    const date = new Date();
    return date.toLocaleString("en-US", {
      timeZone: timezone || "UTC",
      dateStyle: "full",
      timeStyle: "long",
    });
  },
  {
    name: "get_current_time",
    description: "Get the current date and time in a specific timezone",
    schema: z.object({
      timezone: z.string().optional().describe("Timezone like 'Asia/Tokyo'"),
    }),
  }
);

async function test() {
  console.log("🧪 Testing useRemoteToolCalling fix with databricks-claude-sonnet-4-5\n");
  console.log("Configuration:");
  console.log("  • Endpoint: databricks-claude-sonnet-4-5");
  console.log("  • API: Chat Completions (useResponsesApi: false)");
  console.log("  • Tool calling: Client-side (useRemoteToolCalling: false via fix)\n");

  const model = new ChatDatabricks({
    model: "databricks-claude-sonnet-4-5",
    useResponsesApi: false,
    temperature: 0.1,
    maxTokens: 500,
  });

  const modelWithTools = model.bindTools([timeTool]);
  console.log("✅ Tool bound: get_current_time\n");

  try {
    console.log("📤 Sending query: 'What time is it in Tokyo right now?'\n");
    const response = await modelWithTools.invoke("What time is it in Tokyo right now?");
    
    console.log("📥 Response received!");
    console.log(`   Content: "${response.content}"`);
    console.log(`   Tool calls: ${JSON.stringify(response.tool_calls, null, 2)}`);

    if (response.tool_calls && response.tool_calls.length > 0) {
      console.log("\n" + "=".repeat(60));
      console.log("🎉 SUCCESS! The fix is working!");
      console.log("=".repeat(60));
      console.log("\n✓ useRemoteToolCalling: false was applied");
      console.log("✓ Tools were sent in the API request"); 
      console.log("✓ Claude received and understood the tool definitions");
      console.log("✓ Claude made the appropriate tool call\n");
      
      console.log("Tool execution:");
      for (const tc of response.tool_calls) {
        console.log(`  🔧 ${tc.name}(${JSON.stringify(tc.args)})`);
        const result = await timeTool.invoke(tc.args);
        console.log(`     → ${result}\n`);
      }
      
      console.log("✅ Fix confirmed: @databricks/langchainjs now correctly passes");
      console.log("   tools to foundation model endpoints!");
    } else {
      console.log("\n❌ UNEXPECTED: No tool calls were made");
      console.log("   The model responded without using tools:");
      console.log(`   "${response.content}"`);
    }
  } catch (error: any) {
    console.error("\n❌ Error:", error.message || error);
  }
}

test().catch(console.error);
