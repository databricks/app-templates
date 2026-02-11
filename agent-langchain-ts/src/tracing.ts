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

export interface TracingConfig {
  /**
   * MLflow tracking URI (e.g., "http://localhost:5000" or "databricks")
   * Defaults to "databricks" for deployed apps
   */
  mlflowTrackingUri?: string;

  /**
   * MLflow experiment ID to associate traces with
   * Can also be set via MLFLOW_EXPERIMENT_ID env var
   */
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
  private exporter: OTLPTraceExporter;
  private isInitialized = false;

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

    // Construct trace endpoint URL
    const traceUrl = this.buildTraceUrl();
    const headers = this.buildHeaders();

    // Create OTLP exporter
    this.exporter = new OTLPTraceExporter({
      url: traceUrl,
      headers,
    });

    // Create tracer provider with resource attributes
    this.provider = new NodeTracerProvider({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: this.config.serviceName,
      }),
    });

    // Add span processor
    const processor = this.config.useBatchProcessor
      ? new BatchSpanProcessor(this.exporter)
      : new SimpleSpanProcessor(this.exporter);

    this.provider.addSpanProcessor(processor);
  }

  /**
   * Build MLflow trace endpoint URL
   */
  private buildTraceUrl(): string {
    const baseUri = this.config.mlflowTrackingUri;

    // Databricks workspace tracking
    if (baseUri === "databricks") {
      let host = process.env.DATABRICKS_HOST;
      if (!host) {
        throw new Error(
          "DATABRICKS_HOST environment variable required when using 'databricks' tracking URI"
        );
      }
      // Ensure host has https:// prefix
      if (!host.startsWith("http://") && !host.startsWith("https://")) {
        host = `https://${host}`;
      }
      return `${host.replace(/\/$/, "")}/api/2.0/mlflow/traces`;
    }

    // Local or custom MLflow server
    return `${baseUri}/v1/traces`;
  }

  /**
   * Build headers for trace export
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    // Add experiment ID if provided
    if (this.config.experimentId) {
      headers["x-mlflow-experiment-id"] = this.config.experimentId;
    }

    // Add run ID if provided
    if (this.config.runId) {
      headers["x-mlflow-run-id"] = this.config.runId;
    }

    // Add Databricks authentication token
    if (this.config.mlflowTrackingUri === "databricks") {
      let token = process.env.DATABRICKS_TOKEN;

      // For local development, try to get token from Databricks CLI if not set
      if (!token && process.env.DATABRICKS_CONFIG_PROFILE) {
        try {
          const { execSync } = require("child_process");
          const profile = process.env.DATABRICKS_CONFIG_PROFILE;
          const tokenJson = execSync(
            `databricks auth token --profile ${profile}`,
            { encoding: "utf-8" }
          );
          const parsed = JSON.parse(tokenJson);
          token = parsed.access_token;
          console.log(`✅ Using auth token from Databricks CLI (profile: ${profile})`);
        } catch (error) {
          console.warn(
            "⚠️  Could not get auth token from Databricks CLI. Tracing may not work properly."
          );
          console.warn(
            "   Set DATABRICKS_TOKEN env var or ensure databricks CLI is configured."
          );
        }
      }

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      } else {
        console.warn(
          "⚠️  No DATABRICKS_TOKEN found. Traces will not be exported to Databricks."
        );
      }
    }

    return headers;
  }

  /**
   * Initialize tracing - registers the tracer provider and instruments LangChain
   */
  initialize(): void {
    if (this.isInitialized) {
      console.warn("MLflow tracing already initialized");
      return;
    }

    // Register the tracer provider globally
    this.provider.register();

    // Instrument LangChain callbacks to emit traces
    new LangChainInstrumentation().manuallyInstrument(CallbackManagerModule);

    this.isInitialized = true;

    console.log("✅ MLflow tracing initialized", {
      serviceName: this.config.serviceName,
      experimentId: this.config.experimentId,
      trackingUri: this.config.mlflowTrackingUri,
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
export function initializeMLflowTracing(config?: TracingConfig): MLflowTracing {
  const tracing = new MLflowTracing(config);
  tracing.initialize();
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
