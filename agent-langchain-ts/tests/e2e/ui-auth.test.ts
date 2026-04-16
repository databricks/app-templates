/**
 * UI Authentication tests for deployed Databricks Apps
 * Verifies that the Databricks Apps proxy correctly injects user headers
 * and that /api/session and /api/config return valid responses.
 *
 * Run with: APP_URL=<your-app-url> npm run test:e2e
 */

import { describe, test, expect, beforeAll } from "@jest/globals";
import { getDeployedAuthToken, makeAuthHeaders } from "../helpers.js";

if (!process.env.APP_URL) {
  throw new Error("APP_URL environment variable is required to run deployed e2e tests");
}

const AGENT_URL = process.env.APP_URL;
let authToken: string;

beforeAll(async () => {
  authToken = await getDeployedAuthToken();
}, 30000);

describe("UI Authentication", () => {
  test("should return valid user session JSON from /api/session", async () => {
    const response = await fetch(`${AGENT_URL}/api/session`, {
      method: "GET",
      headers: makeAuthHeaders(authToken),
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("application/json");

    const result: any = await response.json();

    if (AGENT_URL.includes("databricksapps.com")) {
      expect(result.user).toBeDefined();
      expect(result.user.email).toMatch(/@/);
      expect(result.user.name).toBeDefined();
    }
  }, 10000);

  test("should return valid config from /api/config", async () => {
    const response = await fetch(`${AGENT_URL}/api/config`, {
      method: "GET",
      headers: makeAuthHeaders(authToken),
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("application/json");

    const result: any = await response.json();
    expect(result.features).toBeDefined();
  }, 10000);

  test("should return JSON from /api/session (not HTML)", async () => {
    const response = await fetch(`${AGENT_URL}/api/session`, {
      method: "GET",
      headers: makeAuthHeaders(authToken),
    });

    const contentType = response.headers.get("content-type");
    const responseText = await response.text();

    expect(responseText).not.toMatch(/^<!DOCTYPE html>/i);
    expect(responseText).not.toMatch(/<html/i);
    expect(contentType).toContain("application/json");
    JSON.parse(responseText); // throws if not valid JSON
  }, 10000);
});
