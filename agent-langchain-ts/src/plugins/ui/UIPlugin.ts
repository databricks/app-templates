/**
 * UIPlugin - Wraps e2e-chatbot-app-next UI as a plugin
 *
 * Responsibilities:
 * - Setup CORS and middleware
 * - Inject /api/* routes (chat, session, history, messages, config)
 * - Serve static files (production)
 * - Optional: Proxy to external agent (if not in-process)
 */

import express, { Application, Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { Plugin, PluginConfig } from '../Plugin.js';

export interface UIPluginConfig extends PluginConfig {
  /** Path to static files (client/dist) */
  staticFilesPath?: string;

  /** Enable development CORS (localhost:3000) */
  isDevelopment?: boolean;

  /** Agent invocations URL (for external agent proxy) */
  agentInvocationsUrl?: string;

  /** Path to UI routes module (default: ui/server/dist/routes/index.js) */
  uiRoutesPath?: string;
}

export class UIPlugin implements Plugin {
  name = 'ui';
  version = '1.0.0';

  private config: UIPluginConfig;
  private uiRoutes: any;

  constructor(config: UIPluginConfig = {}) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('[UIPlugin] Initializing...');

    // Dynamically import UI routes if available
    const routesPath = this.config.uiRoutesPath || '../../../ui/server/dist/routes/index.js';

    try {
      this.uiRoutes = await import(routesPath);
      console.log('[UIPlugin] ✓ UI routes loaded');
    } catch (error) {
      console.warn(`[UIPlugin] ⚠️  Could not load UI routes from ${routesPath}`);
      console.warn('[UIPlugin] UI will run in proxy-only mode');
      this.uiRoutes = null;
    }

    console.log('[UIPlugin] ✓ Initialized');
  }

  injectRoutes(app: Application): void {
    console.log('[UIPlugin] Injecting routes...');

    const isDevelopment = this.config.isDevelopment ?? process.env.NODE_ENV !== 'production';

    // CORS configuration
    app.use(
      cors({
        origin: isDevelopment ? 'http://localhost:3000' : true,
        credentials: true,
      })
    );

    // Body parsing middleware
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));

    // Ping endpoint for health checks
    app.get('/ping', (_req: Request, res: Response) => {
      res.status(200).send('pong');
    });

    // Mount API routes if available
    if (this.uiRoutes) {
      app.use('/api/chat', this.uiRoutes.chatRouter);
      app.use('/api/history', this.uiRoutes.historyRouter);
      app.use('/api/session', this.uiRoutes.sessionRouter);
      app.use('/api/messages', this.uiRoutes.messagesRouter);
      app.use('/api/config', this.uiRoutes.configRouter);
      console.log('[UIPlugin] ✓ API routes injected');
    } else {
      console.log('[UIPlugin] ⚠️  Skipping API routes (not available)');
    }

    // Optional: Proxy to external agent
    if (this.config.agentInvocationsUrl) {
      console.log(`[UIPlugin] Proxying /invocations to ${this.config.agentInvocationsUrl}`);

      app.all('/invocations', async (req: Request, res: Response) => {
        try {
          const forwardHeaders = { ...req.headers } as Record<string, string>;
          delete forwardHeaders['content-length'];

          const response = await fetch(this.config.agentInvocationsUrl!, {
            method: req.method,
            headers: forwardHeaders,
            body:
              req.method !== 'GET' && req.method !== 'HEAD'
                ? JSON.stringify(req.body)
                : undefined,
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
          console.error('[UIPlugin] /invocations proxy error:', error);
          res.status(502).json({
            error: 'Proxy error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

      console.log('[UIPlugin] ✓ Agent proxy configured');
    }

    // Serve static files in production
    if (!isDevelopment && this.config.staticFilesPath) {
      const staticPath = path.resolve(this.config.staticFilesPath);

      if (existsSync(staticPath)) {
        console.log(`[UIPlugin] Serving static files from: ${staticPath}`);
        app.use(express.static(staticPath));

        // SPA fallback - serve index.html for all non-API routes
        app.get(/^\/(?!api|invocations|health).*/, (_req: Request, res: Response) => {
          res.sendFile(path.join(staticPath, 'index.html'));
        });

        console.log('[UIPlugin] ✓ Static files configured');
      } else {
        console.warn(`[UIPlugin] ⚠️  Static files path not found: ${staticPath}`);
      }
    }

    // Error handling middleware
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[UIPlugin] Error:', err);

      // Check if error has toResponse method (duck typing for ChatSDKError)
      if (typeof (err as any).toResponse === 'function') {
        const response = (err as any).toResponse();
        return res.status(response.status).json(response.json);
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: isDevelopment ? err.message : 'An unexpected error occurred',
      });
    });

    console.log('[UIPlugin] ✓ Routes injected');
  }

  async shutdown(): Promise<void> {
    console.log('[UIPlugin] Shutting down...');
    // No specific cleanup needed
    console.log('[UIPlugin] Shutdown complete');
  }
}
