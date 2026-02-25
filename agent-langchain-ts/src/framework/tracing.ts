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
import { WorkspaceClient } from "@databricks/sdk-experimental";

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
  private databricksClient?: WorkspaceClient;

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
    this.config.useBatchProcessor = config.useBatchProcessor ?? (process.env.OTEL_USE_BATCH_PROCESSOR !== "false");

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
   * Link experiment to existing UC trace location
   * This only requires the catalog/schema to exist, not a warehouse
   */
  private async linkExperimentToLocation(
    catalogName: string,
    schemaName: string,
    tableName: string
  ): Promise<string | null> {
    if (!this.config.experimentId || !this.databricksClient) {
      return null;
    }

    try {
      await this.databricksClient.apiClient.request({
        path: `/api/4.0/mlflow/traces/${this.config.experimentId}/link-location`,
        method: "POST",
        headers: new Headers({ "Content-Type": "application/json" }),
        payload: {
          experiment_id: this.config.experimentId,
          uc_schema: {
            catalog_name: catalogName,
            schema_name: schemaName,
          },
        },
        raw: false,
      });

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
    if (!this.config.experimentId || !this.databricksClient) {
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

    try {
      console.log(`🔗 Setting up trace location: ${catalogName}.${schemaName}`);

      // Step 1: Create UC storage location
      await this.databricksClient.apiClient.request({
        path: "/api/4.0/mlflow/traces/location",
        method: "POST",
        headers: new Headers({ "Content-Type": "application/json" }),
        payload: {
          uc_schema: {
            catalog_name: catalogName,
            schema_name: schemaName,
          },
          sql_warehouse_id: warehouseId,
        },
        raw: false,
      });

      return await this.linkExperimentToLocation(catalogName, schemaName, tableName);

    } catch (error: any) {
      // 409 means location already exists, which is fine
      if (error?.message?.includes("409")) {
        return await this.linkExperimentToLocation(catalogName, schemaName, tableName);
      }
      console.warn(`⚠️  Error setting up trace location:`, error);
      return null;
    }
  }

  /**
   * Build headers for trace export using SDK authentication
   * Includes required headers for Databricks OTel collector
   */
  private async buildHeadersWithToken(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    // Get authentication headers from SDK
    if (this.databricksClient) {
      const authHeaders = new Headers();
      await this.databricksClient.config.authenticate(authHeaders);

      // Convert Headers to plain object
      authHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (this.config.mlflowTrackingUri === "databricks") {
      console.warn(
        "⚠️  No Databricks client available for trace export. Traces may not be exported."
      );
    }

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

    // Initialize Databricks SDK client for authentication
    if (this.config.mlflowTrackingUri === "databricks") {
      console.log("🔐 Initializing Databricks SDK authentication...");

      try {
        // Create WorkspaceClient - automatically handles auth chain:
        // 1. Databricks Native (PAT, OAuth M2M, OAuth U2M)
        // 2. Azure Native (Azure CLI, MSI, Client Secret)
        // 3. GCP Native (GCP credentials, default application credentials)
        // 4. Databricks CLI profile
        this.databricksClient = new WorkspaceClient({
          profile: process.env.DATABRICKS_CONFIG_PROFILE,
          host: process.env.DATABRICKS_HOST,
          token: process.env.DATABRICKS_TOKEN,
          clientId: process.env.DATABRICKS_CLIENT_ID,
          clientSecret: process.env.DATABRICKS_CLIENT_SECRET,
        });

        // Verify authentication works by getting config
        await this.databricksClient.config.ensureResolved();
        console.log("✅ Databricks SDK authentication successful");

        // Set up experiment trace location in UC (if not already configured)
        if (!process.env.OTEL_UC_TABLE_NAME) {
          const tableName = await this.setupExperimentTraceLocation();
          if (tableName) {
            // Set environment variable so buildHeadersWithToken() can use it
            process.env.OTEL_UC_TABLE_NAME = tableName;
          }
        }
      } catch (error) {
        console.warn("⚠️  Failed to initialize Databricks SDK authentication:", error);
        console.warn("⚠️  Traces may not be exported without authentication");
      }
    }

    // Build headers with SDK authentication
    const headers = await this.buildHeadersWithToken();

    // Construct trace endpoint URL
    const traceUrl = this.buildTraceUrl();

    // Log detailed export configuration for debugging
    console.log("🔍 OTel Export Configuration:");
    console.log("  URL:", traceUrl);
    console.log("  Headers:", Object.keys(headers).join(", "));
    // Check for both lowercase and capitalized Authorization header
    const hasAuth = headers["Authorization"] || headers["authorization"];
    console.log("  Auth:", hasAuth ? "Present (Bearer token)" : "Missing");
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
      hasAuthClient: !!this.databricksClient,
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

