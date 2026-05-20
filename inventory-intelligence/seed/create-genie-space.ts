#!/usr/bin/env tsx
// create-genie-space.ts — Creates a Databricks Genie space for Inventory Intelligence
//
// Required env vars:
//   DATABRICKS_HOST        e.g. https://dbc-466ea6b9-cadd.cloud.databricks.com
//   DATABRICKS_TOKEN       personal access token or service principal token
//   WAREHOUSE_ID           SQL warehouse ID (from databricks.yml sql_warehouse_id)
//   CATALOG                Unity Catalog catalog name (e.g. oleksandra)
//
// Optional:
//   PARENT_PATH            Workspace path for the space (default: /Shared)
//   APP_SERVICE_PRINCIPAL  Service principal UUID to grant CAN_RUN on the space
//
// Output:
//   Prints the created space ID and instructions for adding it to databricks.yml

const host = process.env.DATABRICKS_HOST?.replace(/\/$/, "");
const token = process.env.DATABRICKS_TOKEN;
const warehouseId = process.env.WAREHOUSE_ID;
const catalog = process.env.CATALOG;
const parentPath = process.env.PARENT_PATH ?? "/Shared";
const appServicePrincipal = process.env.APP_SERVICE_PRINCIPAL;

if (!host || !token || !warehouseId || !catalog) {
  console.error(
    "Missing required env vars. Set: DATABRICKS_HOST, DATABRICKS_TOKEN, WAREHOUSE_ID, CATALOG",
  );
  process.exit(1);
}

// The gold tables that the Genie space should be able to query.
// Must be sorted alphabetically — the API rejects unsorted lists.
const GOLD_TABLES = [
  `${catalog}.gold.inventory_overview`,
  `${catalog}.gold.low_stock_alerts`,
  `${catalog}.gold.replenishment_recommendations`,
  `${catalog}.gold.sales_velocity`,
].sort();

const serializedSpace = JSON.stringify({
  version: 2,
  data_sources: {
    tables: GOLD_TABLES.map((identifier) => ({ identifier })),
  },
});

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${host}/api/2.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  console.log(`Creating Genie space for catalog: ${catalog}`);
  console.log(`Tables: ${GOLD_TABLES.join(", ")}`);

  const space = await api("POST", "/genie/spaces", {
    title: "Inventory Intelligence",
    description:
      "AI-powered inventory analysis. Ask questions about stock levels, replenishment needs, demand forecasts, and store performance.",
    warehouse_id: warehouseId,
    parent_path: parentPath,
    serialized_space: serializedSpace,
  });

  const spaceId: string = space.space_id ?? space.id;

  if (appServicePrincipal) {
    await api("PATCH", `/permissions/genie/${spaceId}`, {
      access_control_list: [
        {
          service_principal_name: appServicePrincipal,
          permission_level: "CAN_RUN",
        },
      ],
    });
    console.log(
      `  Granted CAN_RUN to service principal ${appServicePrincipal}`,
    );
  }

  console.log("");
  console.log(`✓ Genie space created: ${spaceId}`);
  console.log("");
  console.log("Add this to databricks.yml under your target variables:");
  console.log(`  genie_space_id: ${spaceId}`);
  console.log("");
  console.log("Or set it as an environment variable in your app:");
  console.log(`  DATABRICKS_GENIE_SPACE_ID=${spaceId}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
