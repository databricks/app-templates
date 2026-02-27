import { config } from "dotenv";
config();

import { createAgent } from "./agent.js";
import { getMCPServers } from "./mcp-servers.js";
import { startServer } from "./framework/server.js";

const agent = await createAgent({
  model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
  temperature: parseFloat(process.env.TEMPERATURE || "0.1"),
  maxTokens: parseInt(process.env.MAX_TOKENS || "2000", 10),
  useResponsesApi: process.env.USE_RESPONSES_API === "true",
  mcpServers: getMCPServers(),
});

startServer(agent).catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
