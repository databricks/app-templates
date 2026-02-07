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
 */
export function addCustomRoutes(app: Express) {
  const agentUrl = process.env.AGENT_URL || 'http://localhost:8001';

  // Serve UI static files from the client build
  // Path from server/src/exports.ts -> ui/client/dist
  const uiClientPath = path.join(__dirname, '../../client/dist');

  if (existsSync(uiClientPath)) {
    console.log('📦 Serving UI static files from:', uiClientPath);
    app.use(express.static(uiClientPath));

    // SPA fallback - serve index.html for all non-API routes
    app.get(/^\/(?!api).*/, (req, res, next) => {
      // Skip if this is an API route or already handled
      if (req.path.startsWith('/api') || req.path === '/invocations') {
        return next();
      }
      res.sendFile(path.join(uiClientPath, 'index.html'));
    });

    console.log('✅ UI static files served');
  } else {
    console.log('⚠️  UI client build not found at:', uiClientPath);
  }

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
