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
  console.log("🧪 Testing with Anthropic foundation model endpoint\n");
  console.log("Endpoint: anthropic");
  console.log("useResponsesApi: false (Chat Completions API)");
  console.log("useRemoteToolCalling: false (via our fix)\n");

  const model = new ChatDatabricks({
    model: "anthropic",
    useResponsesApi: false,
    temperature: 0.1,
    maxTokens: 500,
  });

  const modelWithTools = model.bindTools([timeTool]);
  console.log("✅ Tool bound: get_current_time\n");

  try {
    console.log("📤 Sending: 'What time is it in Tokyo right now?'...\n");
    const response = await modelWithTools.invoke("What time is it in Tokyo right now?");
    
    console.log("📥 Response received!");
    console.log(`   Content: ${response.content}`);
    console.log(`   Tool calls: ${JSON.stringify(response.tool_calls, null, 2)}`);

    if (response.tool_calls && response.tool_calls.length > 0) {
      console.log("\n🎉 SUCCESS! The fix is working perfectly!");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("✓ useRemoteToolCalling: false was set correctly");
      console.log("✓ Tools were included in the API request"); 
      console.log("✓ Foundation model received tool definitions");
      console.log("✓ Model successfully called the tool");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      
      for (const tc of response.tool_calls) {
        console.log(`🔧 Executing: ${tc.name}(${JSON.stringify(tc.args)})`);
        const result = await timeTool.invoke(tc.args);
        console.log(`   ✓ Result: ${result}\n`);
      }
      
      console.log("✅ The fix in @databricks/langchainjs is confirmed working!");
    } else {
      console.log("\n❌ UNEXPECTED: No tool calls made");
      console.log("   This suggests the fix might not be working");
    }
  } catch (error: any) {
    console.error("\n❌ Error:", error.message || error);
  }
}

test().catch(console.error);
