/**
 * Tracing export test: initializes MLflowTracing against a local OTLP collector
 * and asserts a span is actually exported, with the configured service name.
 * Guards the OTel 2.x wiring (span processors passed at provider construction,
 * resourceFromAttributes) that noop-mode tests never exercise.
 */

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { createServer } from "http";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { execFile } from "child_process";
import { promisify } from "util";

describe("MLflowTracing export", () => {
  let server: Server;
  let baseUrl: string;
  const requests: { path: string; body: Buffer }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        requests.push({ path: req.url ?? "", body: Buffer.concat(chunks) });
        res.writeHead(200, { "content-type": "application/x-protobuf" });
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("exports spans with the configured service name", async () => {
    // Run in a child process, like the other framework tests: the tracing
    // stack uses dynamic import(), which jest's VM doesn't support without
    // --experimental-vm-modules.
    await promisify(execFile)(
      "npx",
      ["tsx", "tests/framework/tracing-export-fixture.ts", baseUrl],
      { timeout: 60000 }
    );

    const exported = requests.filter((r) => r.path === "/v1/traces");
    expect(exported.length).toBeGreaterThan(0);
    // OTLP protobuf carries strings verbatim, so the span name and resource's
    // service.name both appear in the request body.
    const body = Buffer.concat(exported.map((r) => r.body)).toString("latin1");
    expect(body).toContain("tracing-test-span");
    expect(body).toContain("tracing-export-test-svc");
  });
});
