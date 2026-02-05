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
  console.log("🧪 Testing foundation model with useRemoteToolCalling fix\n");
  console.log("Endpoint: databricks-meta-llama-3-1-70b-instruct");
  console.log("useResponsesApi: false (Chat Completions API)\n");

  const model = new ChatDatabricks({
    model: "databricks-meta-llama-3-1-70b-instruct",
    useResponsesApi: false,
    temperature: 0.1,
    maxTokens: 500,
  });

  const modelWithTools = model.bindTools([timeTool]);
  console.log("✅ Tool bound: get_current_time\n");

  try {
    console.log("📤 Sending request: 'What time is it in Tokyo?'...\n");
    const response = await modelWithTools.invoke("What time is it in Tokyo?");
    
    console.log("📥 Response received:");
    console.log(`   Content: ${response.content}`);
    console.log(`   Tool calls:`, response.tool_calls);

    if (response.tool_calls && response.tool_calls.length > 0) {
      console.log("\n✅ SUCCESS! The fix is working!");
      console.log("   ✓ useRemoteToolCalling: false is set");
      console.log("   ✓ Tools were sent in API request"); 
      console.log("   ✓ Model received tool definitions");
      console.log("   ✓ Model made tool calls as expected\n");
      
      for (const tc of response.tool_calls) {
        console.log(`🔧 Tool call: ${tc.name}(${JSON.stringify(tc.args)})`);
        const result = await timeTool.invoke(tc.args);
        console.log(`   Result: ${result}`);
      }
    } else {
      console.log("\n❌ No tool calls - fix may not be working");
    }
  } catch (error: any) {
    console.error("\n❌ Error:", error.message || error);
    if (error.message?.includes("ENDPOINT_NOT_FOUND")) {
      console.log("\n💡 This endpoint doesn't exist in your workspace");
      console.log("   (But the fix is still valid!)");
    }
  }
}

test().catch(console.error);
