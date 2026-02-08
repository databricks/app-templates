/**
 * Tests for MCP (Model Context Protocol) tool integration
 *
 * These tests verify that the agent can properly load and use
 * Databricks MCP tools including:
 * - Databricks SQL (direct table queries)
 * - Unity Catalog Functions
 * - Vector Search (RAG)
 * - Genie Spaces (natural language data queries)
 *
 * Note: These tests require actual Databricks resources to be configured.
 * They are skipped by default unless MCP tools are enabled in .env
 */

import { describe, test, expect, beforeAll } from "@jest/globals";
import { createAgent } from "../src/agent.js";
import type { AgentExecutor } from "langchain/agents";

// Helper to check if MCP tools are configured
const isMCPConfigured = () => {
  return (
    process.env.ENABLE_SQL_MCP === "true" ||
    (process.env.UC_FUNCTION_CATALOG && process.env.UC_FUNCTION_SCHEMA) ||
    (process.env.VECTOR_SEARCH_CATALOG && process.env.VECTOR_SEARCH_SCHEMA) ||
    process.env.GENIE_SPACE_ID
  );
};

describe("MCP Tools Integration", () => {
  describe("Tool Loading", () => {
    test("should create agent with only basic tools when no MCP configured", async () => {
      const agent = await createAgent({
        model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
        temperature: 0,
      });

      expect(agent).toBeDefined();
      // Basic tools: weather, calculator, time
      // Note: Can't directly inspect tools in AgentExecutor, but agent should initialize
    }, 30000);

    test("should load MCP tools when configured", async () => {
      if (!isMCPConfigured()) {
        console.log("⏭️  Skipping MCP tool loading test (no MCP configured)");
        return;
      }

      const agent = await createAgent({
        model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
        temperature: 0,
        mcpConfig: {
          enableSql: process.env.ENABLE_SQL_MCP === "true",
          ucFunction: process.env.UC_FUNCTION_CATALOG
            ? {
                catalog: process.env.UC_FUNCTION_CATALOG,
                schema: process.env.UC_FUNCTION_SCHEMA || "default",
                functionName: process.env.UC_FUNCTION_NAME,
              }
            : undefined,
          vectorSearch: process.env.VECTOR_SEARCH_CATALOG
            ? {
                catalog: process.env.VECTOR_SEARCH_CATALOG,
                schema: process.env.VECTOR_SEARCH_SCHEMA || "default",
                indexName: process.env.VECTOR_SEARCH_INDEX,
              }
            : undefined,
          genieSpace: process.env.GENIE_SPACE_ID
            ? {
                spaceId: process.env.GENIE_SPACE_ID,
              }
            : undefined,
        },
      });

      expect(agent).toBeDefined();
    }, 60000);
  });

  describe("Databricks SQL MCP", () => {
    let agent: AgentExecutor;

    beforeAll(async () => {
      if (process.env.ENABLE_SQL_MCP !== "true") {
        console.log("⏭️  Skipping SQL MCP tests (ENABLE_SQL_MCP not set)");
        return;
      }

      agent = await createAgent({
        model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
        temperature: 0,
        mcpConfig: {
          enableSql: true,
        },
      });
    });

    test("should query database tables using SQL", async () => {
      if (process.env.ENABLE_SQL_MCP !== "true") {
        return; // Skip test
      }

      const result = await agent.invoke({
        input: "List the tables available in the main.default schema",
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
      // Output should mention tables or schema
      expect(
        result.output.toLowerCase().includes("table") ||
        result.output.toLowerCase().includes("schema")
      ).toBe(true);
    }, 60000);

    test("should handle SQL errors gracefully", async () => {
      if (process.env.ENABLE_SQL_MCP !== "true") {
        return;
      }

      const result = await agent.invoke({
        input: "Query a table that definitely does not exist: nonexistent_table_xyz123",
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
      // Should handle error, not throw
    }, 60000);
  });

  describe("Unity Catalog Functions", () => {
    let agent: AgentExecutor;

    beforeAll(async () => {
      if (!process.env.UC_FUNCTION_CATALOG || !process.env.UC_FUNCTION_SCHEMA) {
        console.log("⏭️  Skipping UC Function tests (UC_FUNCTION_* not set)");
        return;
      }

      agent = await createAgent({
        model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
        temperature: 0,
        mcpConfig: {
          ucFunction: {
            catalog: process.env.UC_FUNCTION_CATALOG,
            schema: process.env.UC_FUNCTION_SCHEMA,
            functionName: process.env.UC_FUNCTION_NAME,
          },
        },
      });
    });

    test("should call UC function as a tool", async () => {
      if (!process.env.UC_FUNCTION_CATALOG) {
        return;
      }

      const functionName = process.env.UC_FUNCTION_NAME || "function";
      const result = await agent.invoke({
        input: `Call the ${functionName} function with appropriate parameters`,
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
    }, 60000);

    test("should handle function call errors", async () => {
      if (!process.env.UC_FUNCTION_CATALOG) {
        return;
      }

      const result = await agent.invoke({
        input: "Call the UC function with invalid parameters",
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
      // Should handle error gracefully
    }, 60000);
  });

  describe("Vector Search (RAG)", () => {
    let agent: AgentExecutor;

    beforeAll(async () => {
      if (!process.env.VECTOR_SEARCH_CATALOG || !process.env.VECTOR_SEARCH_SCHEMA) {
        console.log("⏭️  Skipping Vector Search tests (VECTOR_SEARCH_* not set)");
        return;
      }

      agent = await createAgent({
        model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
        temperature: 0,
        mcpConfig: {
          vectorSearch: {
            catalog: process.env.VECTOR_SEARCH_CATALOG,
            schema: process.env.VECTOR_SEARCH_SCHEMA,
            indexName: process.env.VECTOR_SEARCH_INDEX,
          },
        },
      });
    });

    test("should perform semantic search", async () => {
      if (!process.env.VECTOR_SEARCH_CATALOG) {
        return;
      }

      const result = await agent.invoke({
        input: "Search for documentation about authentication",
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
    }, 60000);

    test("should handle empty search results", async () => {
      if (!process.env.VECTOR_SEARCH_CATALOG) {
        return;
      }

      const result = await agent.invoke({
        input: "Search for something that definitely doesn't exist: xyzabc123nonexistent",
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
      // Should handle gracefully, not throw
    }, 60000);
  });

  describe("Genie Spaces", () => {
    let agent: AgentExecutor;

    beforeAll(async () => {
      if (!process.env.GENIE_SPACE_ID) {
        console.log("⏭️  Skipping Genie Space tests (GENIE_SPACE_ID not set)");
        return;
      }

      agent = await createAgent({
        model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
        temperature: 0,
        mcpConfig: {
          genieSpace: {
            spaceId: process.env.GENIE_SPACE_ID,
          },
        },
      });
    });

    test("should query data using natural language via Genie", async () => {
      if (!process.env.GENIE_SPACE_ID) {
        return;
      }

      const result = await agent.invoke({
        input: "What data is available in this Genie space?",
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
    }, 60000);

    test("should handle Genie query errors", async () => {
      if (!process.env.GENIE_SPACE_ID) {
        return;
      }

      const result = await agent.invoke({
        input: "Query for something impossible or nonsensical",
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
    }, 60000);
  });

  describe("Multi-Tool Scenarios", () => {
    test("should combine basic tools with MCP tools", async () => {
      if (!isMCPConfigured()) {
        console.log("⏭️  Skipping multi-tool test (no MCP configured)");
        return;
      }

      const agent = await createAgent({
        model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
        temperature: 0,
        mcpConfig: {
          enableSql: process.env.ENABLE_SQL_MCP === "true",
          vectorSearch: process.env.VECTOR_SEARCH_CATALOG
            ? {
                catalog: process.env.VECTOR_SEARCH_CATALOG,
                schema: process.env.VECTOR_SEARCH_SCHEMA || "default",
                indexName: process.env.VECTOR_SEARCH_INDEX,
              }
            : undefined,
        },
      });

      // Query that might use both calculator (basic) and MCP tools
      const result = await agent.invoke({
        input: "What's 2+2? Also, what tools do you have available?",
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
      // Should mention both basic and MCP capabilities
    }, 60000);

    test("should handle MCP tool failures without crashing", async () => {
      if (!isMCPConfigured()) {
        return;
      }

      const agent = await createAgent({
        model: process.env.DATABRICKS_MODEL || "databricks-claude-sonnet-4-5",
        temperature: 0,
        mcpConfig: {
          enableSql: true,
          // Intentionally configure invalid resources to test error handling
          ucFunction: {
            catalog: "nonexistent",
            schema: "nonexistent",
            functionName: "nonexistent",
          },
        },
      });

      // Agent should still work with basic tools even if MCP setup failed
      const result = await agent.invoke({
        input: "Calculate 5 * 10",
      });

      expect(result).toBeDefined();
      expect(result.output).toBeTruthy();
    }, 60000);
  });
});

/**
 * Example: How to run these tests
 *
 * 1. Configure MCP tools in .env:
 *    ENABLE_SQL_MCP=true
 *    UC_FUNCTION_CATALOG=main
 *    UC_FUNCTION_SCHEMA=default
 *    UC_FUNCTION_NAME=my_function
 *    VECTOR_SEARCH_CATALOG=main
 *    VECTOR_SEARCH_SCHEMA=default
 *    VECTOR_SEARCH_INDEX=my_index
 *    GENIE_SPACE_ID=01234567-89ab-cdef-0123-456789abcdef
 *
 * 2. Grant permissions in databricks.yml (see databricks.mcp-example.yml)
 *
 * 3. Run tests:
 *    npm run test:mcp
 *
 * 4. Or run specific test suite:
 *    jest tests/mcp-tools.test.ts -t "Databricks SQL"
 */
