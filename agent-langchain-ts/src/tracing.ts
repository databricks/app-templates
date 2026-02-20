/**
 * MLflow tracing setup using OpenTelemetry for LangChain instrumentation.
 *
 * This module configures automatic trace export to MLflow, capturing:
 * - LangChain operations (LLM calls, tool invocations, chain executions)
 * - Span timing and hierarchy
 * - Input/output data
 * - Metadata and attributes
 */

import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { LangChainInstrumentation } from "@arizeai/openinference-instrumentation-langchain";
import * as CallbackManagerModule from "@langchain/core/callbacks/manager";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { execSync } from "child_process";

export interface TracingConfig {
  /** MLflow tracking URI (defaults to "databricks") */
  mlflowTrackingUri?: string;

  /** MLflow experiment ID to associate traces with */
  experimentId?: string;

  /**
   * MLflow run ID to nest traces under (optional)
   */
  runId?: string;

  /**
   * Service name for trace identification
   */
  serviceName?: string;

  /**
   * Whether to use batch or simple span processor
   * Batch is more efficient for production, simple is better for debugging
   */
  useBatchProcessor?: boolean;
}

export class MLflowTracing {
  private provider: NodeTracerProvider;
  private exporter!: OTLPTraceExporter;  // Will be initialized in initialize()
  private isInitialized = false;
  private authToken?: string;

  constructor(private config: TracingConfig = {}) {
    // Set defaults
    this.config.mlflowTrackingUri = config.mlflowTrackingUri ||
      process.env.MLFLOW_TRACKING_URI ||
      "databricks";
    this.config.experimentId = config.experimentId ||
      process.env.MLFLOW_EXPERIMENT_ID;
    this.config.runId = config.runId ||
      process.env.MLFLOW_RUN_ID;
    this.config.serviceName = config.serviceName ||
      "langchain-agent-ts";
    this.config.useBatchProcessor = config.useBatchProcessor ?? true;

    // Note: Exporter will be created in initialize() after fetching auth token
    this.provider = new NodeTracerProvider({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: this.config.serviceName,
      }),
    });
  }

  /**
   * Normalize host URL by adding https:// if needed
   */
  private normalizeHost(host: string): string {
    if (!host.startsWith("http://") && !host.startsWith("https://")) {
      return `https://${host}`;
    }
    return host;
  }

  /**
   * Build MLflow trace endpoint URL
   * Uses Databricks OTel collector endpoints (preview feature)
   */
  private buildTraceUrl(): string {
    const baseUri = this.config.mlflowTrackingUri;

    // Databricks workspace tracking
    if (baseUri === "databricks") {
      const rawHost = process.env.DATABRICKS_HOST;
      if (!rawHost) {
        throw new Error(
          "DATABRICKS_HOST environment variable required when using 'databricks' tracking URI"
        );
      }
      const host = this.normalizeHost(rawHost);
      return `${host.replace(/\/$/, "")}/api/2.0/otel/v1/traces`;
    }

    // Local or custom MLflow server
    return `${baseUri}/v1/traces`;
  }

  /**
   * Get OAuth2 access token using client credentials flow
   */
  private async getOAuth2Token(): Promise<string | null> {
    const clientId = process.env.DATABRICKS_CLIENT_ID;
    const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
    const rawHost = process.env.DATABRICKS_HOST;

    if (!clientId || !clientSecret || !rawHost) {
      return null;
    }

    const host = this.normalizeHost(rawHost);

    try {
      const tokenUrl = `${host}/oidc/v1/token`;
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials&scope=all-apis",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`⚠️  OAuth2 token request failed: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json() as { access_token: string };
      return data.access_token;
    } catch (error) {
      console.warn("⚠️  Error getting OAuth2 token:", error);
      return null;
    }
  }

  /**
   * Get OAuth token from Databricks CLI
   * IMPORTANT: OTel collector requires OAuth tokens, not PAT tokens
   */
  private async getOAuthTokenFromCLI(): Promise<string | null> {
    try {
      const profile = process.env.DATABRICKS_CONFIG_PROFILE || "DEFAULT";
      const command = `databricks auth token --profile ${profile}`;

      const output = execSync(command, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const data = JSON.parse(output);
      if (data.access_token) {
        return data.access_token;
      }

      return null;
    } catch (error) {
      // Silent fail - this is expected if databricks CLI isn't installed
      return null;
    }
  }

  /**
   * Link experiment to existing UC trace location
   * This only requires the catalog/schema to exist, not a warehouse
   */
  private async linkExperimentToLocation(
    catalogName: string,
    schemaName: string,
    tableName: string
  ): Promise<string | null> {
    if (!this.config.experimentId) {
      return null;
    }

    const rawHost = process.env.DATABRICKS_HOST;
    if (!rawHost) {
      return null;
    }

    const host = this.normalizeHost(rawHost);

    try {
      const linkUrl = `${host}/api/4.0/mlflow/traces/${this.config.experimentId}/link-location`;
      const linkBody = {
        experiment_id: this.config.experimentId,
        uc_schema: {
          catalog_name: catalogName,
          schema_name: schemaName,
        },
      };

      const linkResponse = await fetch(linkUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(linkBody),
      });

      if (!linkResponse.ok) {
        const errorText = await linkResponse.text();
        console.warn(`⚠️  Failed to link experiment to ${tableName}: ${linkResponse.status} - ${errorText}`);
        return null;
      }

      console.log(`✅ Experiment linked to UC trace location: ${tableName}`);
      return tableName;

    } catch (error) {
      console.warn(`⚠️  Error linking experiment to trace location:`, error);
      return null;
    }
  }

  /**
   * Set up experiment trace location in Unity Catalog
   * Creates UC storage location and links experiment to it
   *
   * This implements the MLflow set_experiment_trace_location() API in TypeScript
   */
  private async setupExperimentTraceLocation(): Promise<string | null> {
    if (!this.config.experimentId) {
      return null;
    }

    const catalogName = process.env.OTEL_UC_CATALOG || "main";
    const schemaName = process.env.OTEL_UC_SCHEMA || "agent_traces";
    const warehouseId = process.env.MLFLOW_TRACING_SQL_WAREHOUSE_ID;
    const tableName = `${catalogName}.${schemaName}.mlflow_experiment_trace_otel_spans`;

    // If no warehouse is specified, try to link directly (works if table already exists)
    if (!warehouseId) {
      console.log(`⚠️  MLFLOW_TRACING_SQL_WAREHOUSE_ID not set, attempting to link to existing table: ${tableName}`);
      return await this.linkExperimentToLocation(catalogName, schemaName, tableName);
    }

    const rawHost = process.env.DATABRICKS_HOST;
    if (!rawHost) {
      return null;
    }

    const host = this.normalizeHost(rawHost);

    try {
      console.log(`🔗 Setting up trace location: ${catalogName}.${schemaName}`);

      // Step 1: Create UC storage location
      const createLocationUrl = `${host}/api/4.0/mlflow/traces/location`;
      const createLocationBody = {
        uc_schema: {
          catalog_name: catalogName,
          schema_name: schemaName,
        },
        sql_warehouse_id: warehouseId,
      };

      const createResponse = await fetch(createLocationUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createLocationBody),
      });

      if (!createResponse.ok && createResponse.status !== 409) {
        const errorText = await createResponse.text();
        console.warn(`⚠️  Failed to create UC location: ${createResponse.status} - ${errorText}`);
        return null;
      }

      return await this.linkExperimentToLocation(catalogName, schemaName, tableName);

    } catch (error) {
      console.warn(`⚠️  Error setting up trace location:`, error);
      return null;
    }
  }

  /**
   * Build headers for trace export using stored auth token
   * Includes required headers for Databricks OTel collector
   */
  private buildHeadersWithToken(): Record<string, string> {
    const headers: Record<string, string> = {};

    // Required for Databricks OTel collector
    if (this.config.mlflowTrackingUri === "databricks") {
      headers["content-type"] = "application/x-protobuf";

      // Unity Catalog table name for trace storage
      const ucTableName = process.env.OTEL_UC_TABLE_NAME;
      if (ucTableName) {
        headers["X-Databricks-UC-Table-Name"] = ucTableName;
        console.log(`📊 Traces will be stored in UC table: ${ucTableName}`);
      } else {
        console.warn(
          "⚠️  OTEL_UC_TABLE_NAME not set. You need to:\n" +
          "   1. Enable OTel collector preview in your workspace\n" +
          "   2. Create UC tables for trace storage\n" +
          "   3. Set OTEL_UC_TABLE_NAME=<catalog>.<schema>.<prefix>_otel_spans"
        );
      }
    }

    // Add experiment ID if provided
    if (this.config.experimentId) {
      headers["x-mlflow-experiment-id"] = this.config.experimentId;
    }

    // Add run ID if provided
    if (this.config.runId) {
      headers["x-mlflow-run-id"] = this.config.runId;
    }

    // Add Databricks authentication token if available
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    } else if (this.config.mlflowTrackingUri === "databricks") {
      console.warn(
        "⚠️  No auth token available for trace export. Traces may not be exported."
      );
    }

    return headers;
  }

  /**
   * Initialize tracing - registers the tracer provider and instruments LangChain
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn("MLflow tracing already initialized");
      return;
    }

    // Get authentication token (async for OAuth2)
    if (this.config.mlflowTrackingUri === "databricks") {
      // Try OAuth2 first (for Databricks Apps)
      if (process.env.DATABRICKS_CLIENT_ID && process.env.DATABRICKS_CLIENT_SECRET) {
        console.log("🔐 Getting OAuth2 access token for trace export...");
        this.authToken = await this.getOAuth2Token() || undefined;
        if (this.authToken) {
          console.log("✅ OAuth2 token obtained for trace export");
        }
      }

      // Try Databricks CLI (preferred for local development)
      // IMPORTANT: OTel collector requires OAuth tokens, not PAT tokens
      if (!this.authToken && process.env.DATABRICKS_CONFIG_PROFILE) {
        console.log("🔐 Getting OAuth token from Databricks CLI...");
        this.authToken = await this.getOAuthTokenFromCLI() || undefined;
        if (this.authToken) {
          const profile = process.env.DATABRICKS_CONFIG_PROFILE;
          console.log(`✅ Using OAuth token from Databricks CLI (profile: ${profile})`);
        }
      }

      // Fallback to direct token (may not work with OTel collector)
      if (!this.authToken && process.env.DATABRICKS_TOKEN) {
        this.authToken = process.env.DATABRICKS_TOKEN;
        console.log("⚠️  Using DATABRICKS_TOKEN (PAT token) - OTel collector may require OAuth token instead");
      }

      // Set up experiment trace location in UC (if not already configured)
      if (this.authToken && !process.env.OTEL_UC_TABLE_NAME) {
        const tableName = await this.setupExperimentTraceLocation();
        if (tableName) {
          // Set environment variable so buildHeadersWithToken() can use it
          process.env.OTEL_UC_TABLE_NAME = tableName;
        }
      }
    }

    // Build headers with auth token
    const headers = this.buildHeadersWithToken();

    // Construct trace endpoint URL
    const traceUrl = this.buildTraceUrl();

    // Log detailed export configuration for debugging
    console.log("🔍 OTel Export Configuration:");
    console.log("  URL:", traceUrl);
    console.log("  Headers:", Object.keys(headers).join(", "));
    console.log("  Auth:", headers["Authorization"] ? "Present (Bearer token)" : "Missing");
    console.log("  Content-Type:", headers["content-type"]);
    console.log("  UC Table:", headers["X-Databricks-UC-Table-Name"] || "Not set");
    console.log("  Experiment ID:", headers["x-mlflow-experiment-id"] || "Not set");

    // Create OTLP exporter with headers
    this.exporter = new OTLPTraceExporter({
      url: traceUrl,
      headers,
      timeoutMillis: 30000,
    });

    // Add span processor with error handling
    const processor = this.config.useBatchProcessor
      ? new BatchSpanProcessor(this.exporter)
      : new SimpleSpanProcessor(this.exporter);

    this.provider.addSpanProcessor(processor);

    // Register the tracer provider globally
    this.provider.register();

    // Instrument LangChain callbacks to emit traces
    new LangChainInstrumentation().manuallyInstrument(CallbackManagerModule);

    this.isInitialized = true;

    console.log("✅ MLflow tracing initialized", {
      serviceName: this.config.serviceName,
      experimentId: this.config.experimentId,
      trackingUri: this.config.mlflowTrackingUri,
      hasAuthToken: !!this.authToken,
    });
  }

  /**
   * Shutdown tracing gracefully - flushes pending spans
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.provider.shutdown();
      console.log("✅ MLflow tracing shutdown complete");
    } catch (error) {
      console.error("Error shutting down tracing:", error);
      throw error;
    }
  }

  /**
   * Force flush pending spans (useful before process exit)
   */
  async flush(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.provider.forceFlush();
    } catch (error) {
      console.error("Error flushing traces:", error);
      throw error;
    }
  }
}

/**
 * Initialize MLflow tracing with default configuration
 * Call this once at application startup
 */
export async function initializeMLflowTracing(config?: TracingConfig): Promise<MLflowTracing> {
  const tracing = new MLflowTracing(config);
  await tracing.initialize();
  return tracing;
}

/**
 * Gracefully shutdown handler for process termination
 */
export function setupTracingShutdownHandlers(tracing: MLflowTracing): void {
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, flushing traces...`);
    try {
      await tracing.flush();
      await tracing.shutdown();
      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("beforeExit", () => tracing.flush());
}
