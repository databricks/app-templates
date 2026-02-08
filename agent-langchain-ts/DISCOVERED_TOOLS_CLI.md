# Agent Tools and Data Sources Discovery

## Genie Spaces (20)

**What they are:** Natural language interface to your data

**How to use:** Connect via Genie MCP server at `<workspace_host>/api/2.0/mcp/genie/{space_id}`

**Add to agent:**
```typescript
// In .env
GENIE_SPACE_ID=<space_id>

// In src/tools.ts - add to getMCPTools()
if (config.genieSpaceId) {
  mcpServers['genie'] = new DatabricksMCPServer(
    buildMCPServerConfig({
      url: `${host}/api/2.0/mcp/genie/${config.genieSpaceId}`,
    })
  );
}
```

### Order Performance Metrics
- **ID:** `01f103adf18216c889f7baa06e34cacc`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f103adf18216c889f7baa06e34cacc`

### Healthcare Claims Analysis
- **ID:** `01f103a144861bafbcf68efdb4ae456a`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f103a144861bafbcf68efdb4ae456a`

### Parsed Data Overview
- **ID:** `01f103a12540131a80ce12a58ca203f8`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f103a12540131a80ce12a58ca203f8`

### Metric Performance Overview
- **ID:** `01f103a1179b1f37b30fd6e06a4f7952`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f103a1179b1f37b30fd6e06a4f7952`

### Nike Product Inventory
- **ID:** `01f103a007d716a99aeb4ac5e931bc4f`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f103a007d716a99aeb4ac5e931bc4f`

### Manufacturing Plants Overview
- **ID:** `01f1039a92f51888ba4c3690651ecfd5`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f1039a92f51888ba4c3690651ecfd5`

### Customer and Supplier Data
- **ID:** `01f103937c1c157683e2f90f900e379b`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f103937c1c157683e2f90f900e379b`

### Formula 1 Race Analytics
- **ID:** `01f1037ebc531bbdb27b875271b31bf4`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f1037ebc531bbdb27b875271b31bf4`

### Databricks Audit Logs Analysis
- **ID:** `01f1037245131eb3ae0f583a20190b34`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f1037245131eb3ae0f583a20190b34`

### Names Dataset Analysis
- **ID:** `01f1036f991c1968b753e496085ca8a8`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f1036f991c1968b753e496085ca8a8`

### Novartis Sales and Account Analysis
- **ID:** `01f1032e1de316348a340c8ee885e6c3`
- **Description:** Showcase how you can chat with combined data from Salesforce and SQL
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f1032e1de316348a340c8ee885e6c3`

### Novartis Reserch Agent (Salesforce & Sales Data)
- **ID:** `01f1033acdc41f2e999eeab8e5600892`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f1033acdc41f2e999eeab8e5600892`

### ka-d8e67659-endpoint
- **ID:** `01f0c4c9431611b8843a80bfd9ebe916`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f0c4c9431611b8843a80bfd9ebe916`

### Cloud Usage and Billing Analytics
- **ID:** `01f102fdf32d1507b0c58621d308d661`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f102fdf32d1507b0c58621d308d661`

### Retail Sales Performance
- **ID:** `01f102f7b4a3187a88e2dabd5d9ce040`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f102f7b4a3187a88e2dabd5d9ce040`

### ka-c0ab8a1c-endpoint
- **ID:** `01f09d5f04b311a183beaadf6a8080dc`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f09d5f04b311a183beaadf6a8080dc`

### Vacation Rental Analytics
- **ID:** `01f102cc858e187b877b8476dc7f8745`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f102cc858e187b877b8476dc7f8745`

### Bakehouse Sales Analytics
- **ID:** `01f10278cb1b178eab20fed529bcd127`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f10278cb1b178eab20fed529bcd127`

### takashi-genie-space-value-index
- **ID:** `01f1025a11b212478ed82ccf89e47725`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f1025a11b212478ed82ccf89e47725`

### ckc_test_genie_space
- **ID:** `01f1024f091a169eb66f9de0c0f2c572`
- **MCP URL:** `<workspace_host>/api/2.0/mcp/genie/01f1024f091a169eb66f9de0c0f2c572`


## Custom MCP Servers (6)

**What:** Your own MCP servers deployed as Databricks Apps (names starting with mcp-)

**How to use:** Access via `{app_url}/mcp`

**⚠️ Important:** Custom MCP server apps require manual permission grants:
1. Get your agent app's service principal: `databricks apps get <agent-app> --output json | jq -r '.service_principal_name'`
2. Grant permission: `databricks apps update-permissions <mcp-server-app> --service-principal <sp-name> --permission-level CAN_USE`

- **mcp-chloe-test**
  - URL: https://mcp-chloe-test-6051921418418893.staging.aws.databricksapps.com
  - Status: ACTIVE
  - Description: App stopped by the Databricks Apps team. Please attach the budget policy 'persist-app' to your app if you would like to keep it. You can add the budget policy by selecting 'Edit > Advanced settings' and then selecting the budget policy 'persist-app'. Otherwise, it will be deleted this upcoming Friday. 


- **mcp-google-drive-2026-02-04**
  - URL: https://mcp-google-drive-2026-02-04-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Description: App stopped by the Databricks Apps team. Please attach the budget policy 'persist-app' to your app if you would like to keep it. You can add the budget policy by selecting 'Edit > Advanced settings' and then selecting the budget policy 'persist-app'. Otherwise, it will be deleted this upcoming Friday. 

Google drive MCP server
- **mcp-openai-app**
  - URL: https://mcp-openai-app-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Description: App stopped by the Databricks Apps team. Please attach the budget policy 'persist-app' to your app if you would like to keep it. You can add the budget policy by selecting 'Edit > Advanced settings' and then selecting the budget policy 'persist-app'. Otherwise, it will be deleted this upcoming Friday. 


- **mcp-server-hello-world**
  - URL: https://mcp-server-hello-world-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Description: App stopped by the Databricks Apps team. Please attach the budget policy 'persist-app' to your app if you would like to keep it. You can add the budget policy by selecting 'Edit > Advanced settings' and then selecting the budget policy 'persist-app'. Otherwise, it will be deleted this upcoming Friday. 

A basic MCP server.
- **mcp-server-hello-world-2**
  - URL: https://mcp-server-hello-world-2-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Description: App stopped by the Databricks Apps team. Please attach the budget policy 'persist-app' to your app if you would like to keep it. You can add the budget policy by selecting 'Edit > Advanced settings' and then selecting the budget policy 'persist-app'. Otherwise, it will be deleted this upcoming Friday. 

A basic MCP server.
- **mcp-server-openapi-spec-arv**
  - URL: https://mcp-server-openapi-spec-arv-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Description: App stopped by the Databricks Apps team. Please attach the budget policy 'persist-app' to your app if you would like to keep it. You can add the budget policy by selecting 'Edit > Advanced settings' and then selecting the budget policy 'persist-app'. Otherwise, it will be deleted this upcoming Friday. 

Make any REST API usable by agents by wrapping it in an MCP server. Deploys an MCP server that exposes REST API operations from an OpenAPI specification stored in a Unity Catalog volume.

## All Databricks Apps (150)

Showing all apps in your workspace (not necessarily MCP servers):

- **20251024-mlflow-otel-zero**
  - URL: https://20251024-mlflow-otel-zero-6051921418418893.staging.aws.databricksapps.com
  - Status: ACTIVE
  - Creator: james.wu@databricks.com
- **adtech-streaming-demo**
  - URL: https://adtech-streaming-demo-6051921418418893.staging.aws.databricksapps.com
  - Status: ACTIVE
  - Creator: dattatraya.walake@databricks.com
- **agent-builder-assistant**
  - URL: https://agent-builder-assistant-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Creator: sueann@databricks.com
- **agent-customer-support**
  - URL: https://agent-customer-support-6051921418418893.staging.aws.databricksapps.com
  - Status: ACTIVE
  - Creator: bryan.qiu@databricks.com
- **agent-everything**
  - URL: https://agent-everything-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Creator: zeyi.f@databricks.com
- **agent-fadsfsadf**
  - URL: https://agent-fadsfsadf-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Creator: zeyi.f@databricks.com
- **agent-fasdfasf**
  - URL: https://agent-fasdfasf-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Creator: zeyi.f@databricks.com
- **agent-gdsfbgxcb**
  - URL: https://agent-gdsfbgxcb-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Creator: zeyi.f@databricks.com
- **agent-genie-claims**
  - URL: https://agent-genie-claims-6051921418418893.staging.aws.databricksapps.com
  - Status: STOPPED
  - Creator: nitin.aggarwal@databricks.com
- **agent-langgraph**
  - URL: https://agent-langgraph-6051921418418893.staging.aws.databricksapps.com
  - Status: ACTIVE
  - Creator: bryan.qiu@databricks.com

*...and 140 more*


---

## Next Steps

1. **Choose a resource** from above (e.g., Genie space)
2. **Configure in agent** (see code examples above)
3. **Grant permissions** in `databricks.yml`
4. **Test locally** with `npm run dev:agent`
5. **Deploy** with `databricks bundle deploy`