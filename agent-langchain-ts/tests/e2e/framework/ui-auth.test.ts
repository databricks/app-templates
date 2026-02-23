/**
 * UI Authentication integration test
 * Tests that the /api/session endpoint returns valid user session data
 *
 * Prerequisites:
 * - Agent server running on http://localhost:8000 (production mode)
 *   OR deployed app URL in APP_URL env var
 * - UI backend running on http://localhost:3000 (internal)
 * - For deployed apps: DATABRICKS_TOKEN env var with OAuth token
 *
 * Run with: npm run test:integration tests/ui-auth.test.ts
 * For deployed app: APP_URL=<url> DATABRICKS_TOKEN=$(databricks auth token --profile dogfood | jq -r '.access_token') npm test tests/ui-auth.test.ts
 */

import { describe, test, expect } from '@jest/globals';
import { getDeployedAuthHeaders } from '../../helpers.js';

const AGENT_URL = process.env.APP_URL || "http://localhost:8000";

describe("UI Authentication", () => {
  test("should return valid user session JSON from /api/session", async () => {
    const response = await fetch(`${AGENT_URL}/api/session`, {
      method: "GET",
      headers: getDeployedAuthHeaders(AGENT_URL),
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    // Should return JSON, not HTML
    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("application/json");

    const result: any = await response.json();

    // For deployed apps, should have user data
    if (AGENT_URL.includes("databricksapps.com")) {
      expect(result.user).toBeDefined();
      expect(result.user.email).toBeDefined();
      expect(result.user.name).toBeDefined();

      console.log("✅ User session:", result.user);
    } else {
      // Local development may not have user session
      console.log("ℹ️  Local session:", result);
    }
  }, 10000);

  test("should return valid config from /api/config", async () => {
    const response = await fetch(`${AGENT_URL}/api/config`, {
      method: "GET",
      headers: getDeployedAuthHeaders(AGENT_URL),
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    // Should return JSON, not HTML
    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("application/json");

    const result: any = await response.json();

    // Should have feature flags
    expect(result.features).toBeDefined();

    console.log("✅ Config:", result);
  }, 10000);

  test("should proxy to UI backend and preserve auth headers", async () => {
    // Test that /api/* routes are properly proxied to UI backend
    // and authentication headers are preserved
    const response = await fetch(`${AGENT_URL}/api/session`, {
      method: "GET",
      headers: getDeployedAuthHeaders(AGENT_URL),
    });

    expect(response.ok).toBe(true);
    const result: any = await response.json();

    // Verify the proxy worked and auth was preserved
    if (AGENT_URL.includes("databricksapps.com")) {
      expect(result.user).toBeDefined();
      expect(result.user.email).toMatch(/@/); // Valid email format
      console.log("✅ Proxy preserves authentication");
    }
  }, 10000);

  test("should return JSON from /api/session (not HTML)", async () => {
    // This test specifically validates the fix for the authentication issue
    // where /api/session was returning HTML instead of JSON
    const response = await fetch(`${AGENT_URL}/api/session`, {
      method: "GET",
      headers: getDeployedAuthHeaders(AGENT_URL),
    });

    const contentType = response.headers.get("content-type");
    const responseText = await response.text();

    // Should NOT be HTML
    expect(responseText).not.toMatch(/^<!DOCTYPE html>/i);
    expect(responseText).not.toMatch(/<html/i);

    // Should be valid JSON
    expect(contentType).toContain("application/json");
    const parsed = JSON.parse(responseText);
    expect(parsed).toBeDefined();

    console.log("✅ /api/session returns JSON, not HTML");
  }, 10000);
});
