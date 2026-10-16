/**
 * Fixture for tracing.test.ts: runs in its own process (real ESM loader) so
 * MLflowTracing initializes exactly as in the app, then emits one span.
 * Usage: tsx tests/framework/tracing-export-fixture.ts <collector-base-url>
 */
import { trace } from "@opentelemetry/api";
import { MLflowTracing } from "../../src/framework/tracing.js";

const tracing = new MLflowTracing({
  mlflowTrackingUri: process.argv[2],
  serviceName: "tracing-export-test-svc",
  useBatchProcessor: false,
});
await tracing.initialize();
trace.getTracer("tracing-test").startSpan("tracing-test-span").end();
await tracing.flush();
await tracing.shutdown();
