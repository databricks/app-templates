import { config } from "dotenv";
config();

import { createApp, agent, server } from "@databricks/appkit";
import { basicTools } from "./tools.js";
import { getMCPServers } from "./mcp-servers.js";

await createApp({
  plugins: [
    agent({
      model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
      useResponsesApi: process.env.USE_RESPONSES_API === "true",
      temperature: parseFloat(process.env.TEMPERATURE || "0.1"),
      maxTokens: parseInt(process.env.MAX_TOKENS || "2000", 10),
      mcpServers: getMCPServers(),
      tools: basicTools,
      traceDestination: { type: "mlflow" },
    }),
    server({ autoStart: true }),
  ],
});
