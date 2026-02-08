#!/usr/bin/env tsx
/**
 * Discover available tools using Databricks CLI (more reliable than SDK)
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

interface DiscoveryResults {
  genie_spaces: any[];
  custom_mcp_servers: any[];
  apps: any[];
}

function runCLI(command: string): any {
  try {
    const output = execSync(`databricks ${command} --output json`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(output);
  } catch (error: any) {
    console.error(`Error running: databricks ${command}`);
    return null;
  }
}

async function discoverGenieSpaces(): Promise<any[]> {
  const spaces: any[] = [];

  try {
    // Try to list Genie spaces using CLI
    const result = runCLI("genie list-spaces");
    if (result && result.spaces) {
      for (const space of result.spaces) {
        spaces.push({
          type: "genie_space",
          id: space.space_id,
          name: space.title || space.name,
          description: space.description,
        });
      }
    }
  } catch (error: any) {
    console.error(`Note: Could not list Genie spaces - ${error.message}`);
  }

  return spaces;
}

async function discoverCustomMCPServers(): Promise<any[]> {
  const customServers: any[] = [];

  try {
    const apps = runCLI("apps list");
    if (apps && Array.isArray(apps)) {
      for (const app of apps) {
        if (app.name && app.name.startsWith("mcp-")) {
          customServers.push({
            type: "custom_mcp_server",
            name: app.name,
            url: app.url,
            status: app.app_status?.state || app.compute_status?.state,
            description: app.description,
          });
        }
      }
    }
  } catch (error: any) {
    console.error(`Error discovering custom MCP servers: ${error.message}`);
  }

  return customServers;
}

async function discoverApps(): Promise<any[]> {
  const apps: any[] = [];

  try {
    const result = runCLI("apps list");
    if (result && Array.isArray(result)) {
      for (const app of result) {
        apps.push({
          name: app.name,
          url: app.url,
          status: app.app_status?.state || app.compute_status?.state,
          description: app.description,
          creator: app.creator,
        });
      }
    }
  } catch (error: any) {
    console.error(`Error discovering apps: ${error.message}`);
  }

  return apps;
}

function formatOutputMarkdown(results: DiscoveryResults): string {
  const lines: string[] = ["# Agent Tools and Data Sources Discovery\n"];

  const host = process.env.DATABRICKS_HOST || "<workspace_host>";

  // Genie Spaces
  const spaces = results.genie_spaces;
  if (spaces.length > 0) {
    lines.push(`## Genie Spaces (${spaces.length})\n`);
    lines.push("**What they are:** Natural language interface to your data\n");
    lines.push(`**How to use:** Connect via Genie MCP server at \`${host}/api/2.0/mcp/genie/{space_id}\`\n`);
    lines.push("**Add to agent:**");
    lines.push("```typescript");
    lines.push("// In .env");
    lines.push("GENIE_SPACE_ID=<space_id>");
    lines.push("");
    lines.push("// In src/tools.ts - add to getMCPTools()");
    lines.push("if (config.genieSpaceId) {");
    lines.push("  mcpServers['genie'] = new DatabricksMCPServer(");
    lines.push("    buildMCPServerConfig({");
    lines.push(`      url: \`\${host}/api/2.0/mcp/genie/\${config.genieSpaceId}\`,`);
    lines.push("    })");
    lines.push("  );");
    lines.push("}");
    lines.push("```\n");

    for (const space of spaces) {
      lines.push(`### ${space.name}`);
      lines.push(`- **ID:** \`${space.id}\``);
      if (space.description) {
        lines.push(`- **Description:** ${space.description}`);
      }
      lines.push(`- **MCP URL:** \`${host}/api/2.0/mcp/genie/${space.id}\``);
      lines.push("");
    }
    lines.push("");
  } else {
    lines.push("## Genie Spaces\n");
    lines.push("No Genie spaces found. Create one in your Databricks workspace to enable natural language data queries.\n");
  }

  // Custom MCP Servers (Databricks Apps)
  const customServers = results.custom_mcp_servers;
  if (customServers.length > 0) {
    lines.push(`## Custom MCP Servers (${customServers.length})\n`);
    lines.push("**What:** Your own MCP servers deployed as Databricks Apps (names starting with mcp-)\n");
    lines.push("**How to use:** Access via `{app_url}/mcp`\n");
    lines.push("**⚠️ Important:** Custom MCP server apps require manual permission grants:");
    lines.push("1. Get your agent app's service principal: `databricks apps get <agent-app> --output json | jq -r '.service_principal_name'`");
    lines.push("2. Grant permission: `databricks apps update-permissions <mcp-server-app> --service-principal <sp-name> --permission-level CAN_USE`\n");

    for (const server of customServers) {
      lines.push(`- **${server.name}**`);
      if (server.url) {
        lines.push(`  - URL: ${server.url}`);
      }
      if (server.status) {
        lines.push(`  - Status: ${server.status}`);
      }
      if (server.description) {
        lines.push(`  - Description: ${server.description}`);
      }
    }
    lines.push("");
  }

  // All Apps (for reference)
  const apps = results.apps;
  if (apps.length > 0) {
    lines.push(`## All Databricks Apps (${apps.length})\n`);
    lines.push("Showing all apps in your workspace (not necessarily MCP servers):\n");

    for (const app of apps.slice(0, 10)) {
      lines.push(`- **${app.name}**`);
      if (app.url) {
        lines.push(`  - URL: ${app.url}`);
      }
      if (app.status) {
        lines.push(`  - Status: ${app.status}`);
      }
      if (app.creator) {
        lines.push(`  - Creator: ${app.creator}`);
      }
    }
    if (apps.length > 10) {
      lines.push(`\n*...and ${apps.length - 10} more*\n`);
    }
    lines.push("");
  }

  lines.push("---\n");
  lines.push("## Next Steps\n");
  lines.push("1. **Choose a resource** from above (e.g., Genie space)");
  lines.push("2. **Configure in agent** (see code examples above)");
  lines.push("3. **Grant permissions** in `databricks.yml`");
  lines.push("4. **Test locally** with `npm run dev:agent`");
  lines.push("5. **Deploy** with `databricks bundle deploy`");

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  let format = "markdown";
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format" && i + 1 < args.length) {
      format = args[++i];
    } else if (args[i] === "--output" && i + 1 < args.length) {
      output = args[++i];
    }
  }

  console.error("Discovering available tools using Databricks CLI...\n");

  const results: DiscoveryResults = {
    genie_spaces: [],
    custom_mcp_servers: [],
    apps: [],
  };

  console.error("- Genie Spaces...");
  results.genie_spaces = await discoverGenieSpaces();

  console.error("- Custom MCP Servers (Apps with mcp- prefix)...");
  results.custom_mcp_servers = await discoverCustomMCPServers();

  console.error("- All Apps...");
  results.apps = await discoverApps();

  // Format output
  let outputText: string;
  if (format === "json") {
    outputText = JSON.stringify(results, null, 2);
  } else {
    outputText = formatOutputMarkdown(results);
  }

  // Write output
  if (output) {
    writeFileSync(output, outputText);
    console.error(`\nResults written to ${output}`);
  } else {
    console.log("\n" + outputText);
  }

  // Print summary
  console.error("\n=== Discovery Summary ===");
  console.error(`Genie Spaces: ${results.genie_spaces.length}`);
  console.error(`Custom MCP Servers: ${results.custom_mcp_servers.length}`);
  console.error(`Total Apps: ${results.apps.length}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
