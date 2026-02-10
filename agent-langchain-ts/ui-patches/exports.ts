/**
 * Custom exports for the agent-langchain-ts integration
 *
 * This file adds:
 * 1. Proxy route for /invocations (Responses API endpoint)
 * 2. Static file serving for the UI frontend
 */

import type { Express } from 'express';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Add custom routes to the UI server
 * This is called by the UI server's index.ts if this file exists
 *
 * NOTE: Static file serving is handled by the agent server (port 8000).
 * This UI backend (port 3000) should ONLY handle /api/* routes and proxy /invocations.
 */
export function addCustomRoutes(app: Express) {
  const agentUrl = process.env.AGENT_URL || 'http://localhost:8001';

  // Proxy /invocations to the agent server
  app.all('/invocations', async (req, res) => {
    try {
      const response = await fetch(`${agentUrl}/invocations`, {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      });

      // Copy status and headers
      res.status(response.status);
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      // Stream the response body
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (error) {
      console.error('[/invocations proxy] Error:', error);
      res.status(502).json({
        error: 'Proxy error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  console.log('✅ Custom routes added: /invocations proxy');
}
