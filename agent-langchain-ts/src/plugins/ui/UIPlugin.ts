/**
 * UIPlugin - Mounts e2e-chatbot-app-next UI as a sub-application
 *
 * Responsibilities:
 * - Import UI Express app from ui/server/dist/index.mjs
 * - Mount as sub-application (provides /api/*, static files, etc.)
 * - Optional: Proxy to external agent (if not in-process)
 */

import { Application, Request, Response } from 'express';
import { Plugin, PluginConfig } from '../Plugin.js';
import { getDefaultUIRoutesPath } from '../../utils/paths.js';

export interface UIPluginConfig extends PluginConfig {
  /** Path to static files (client/dist) */
  staticFilesPath?: string;

  /** Enable development CORS (localhost:3000) */
  isDevelopment?: boolean;

  /** Agent invocations URL (for external agent proxy) */
  agentInvocationsUrl?: string;

  /** Path to UI app module (default: ui/server/dist/index.mjs) */
  uiRoutesPath?: string;
}

export class UIPlugin implements Plugin {
  name = 'ui';
  version = '1.0.0';

  private config: UIPluginConfig;
  private uiApp: Application | null = null;

  constructor(config: UIPluginConfig = {}) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('[UIPlugin] Initializing...');

    // Dynamically import UI app (Express application)
    // Use absolute path from paths.ts for consistency
    const appPath = this.config.uiRoutesPath || getDefaultUIRoutesPath();

    try {
      // Prevent UI server from auto-starting when imported
      process.env.UI_AUTO_START = 'false';

      const uiModule = await import(appPath);
      this.uiApp = uiModule.default;  // Import default export (Express app)
      console.log('[UIPlugin] ✓ UI app loaded');
    } catch (error) {
      console.warn(`[UIPlugin] ⚠️  Could not load UI app from ${appPath}`);
      console.warn('[UIPlugin] UI will run in proxy-only mode');
      this.uiApp = null;
    }

    console.log('[UIPlugin] ✓ Initialized');
  }

  injectRoutes(app: Application): void {
    console.log('[UIPlugin] Injecting routes...');

    // IMPORTANT: Mount UI app AFTER agent routes have been registered
    // The UI app's catch-all route should not intercept agent endpoints

    if (this.uiApp) {
      // Mount the UI app
      // Note: This is done at the end to ensure agent routes take precedence
      app.use(this.uiApp);
      console.log('[UIPlugin] ✓ UI app mounted');
    } else {
      console.log('[UIPlugin] ⚠️  UI app not available');

      // Fallback: Proxy to external agent if UI is not available
      // NOTE: This proxy logic is also duplicated in e2e-chatbot-app-next/server/src/index.ts
      // When the UI app IS loaded (normal case), it handles proxying itself via API_PROXY env var.
      // This fallback is only used when UIPlugin cannot load the UI app module.
      // Keep these two implementations in sync if either changes.
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
    }

    console.log('[UIPlugin] ✓ Routes injected');
  }

  async shutdown(): Promise<void> {
    console.log('[UIPlugin] Shutting down...');
    // No specific cleanup needed
    console.log('[UIPlugin] Shutdown complete');
  }
}
