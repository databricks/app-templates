/**
 * Plugin System Unit Tests
 * Tests the plugin lifecycle, PluginManager orchestration, and individual plugins
 */

import express, { Application } from 'express';
import { Plugin, PluginContext } from '../src/framework/plugins/Plugin.js';
import { PluginManager } from '../src/framework/plugins/PluginManager.js';
import { AgentPlugin } from '../src/framework/plugins/agent/AgentPlugin.js';
import { UIPlugin } from '../src/framework/plugins/ui/UIPlugin.js';

// ============================================================================
// Mock Plugin for Testing
// ============================================================================

class MockPlugin implements Plugin {
  name: string;
  version = '1.0.0';
  initialized = false;
  routesInjected = false;

  private onInitialize?: () => void;
  private onShutdown?: () => void;

  constructor(
    name: string,
    onInitialize?: () => void,
    onShutdown?: () => void
  ) {
    this.name = name;
    this.onInitialize = onInitialize;
    this.onShutdown = onShutdown;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
    if (this.onInitialize) {
      this.onInitialize();
    }
  }

  injectRoutes(app: Application): void {
    this.routesInjected = true;
    app.get(`/${this.name}`, (_req, res) => {
      res.json({ plugin: this.name });
    });
  }

  async shutdown(): Promise<void> {
    if (this.onShutdown) {
      this.onShutdown();
    }
  }
}

class FailingPlugin implements Plugin {
  name = 'failing';
  version = '1.0.0';

  async initialize(): Promise<void> {
    throw new Error('Initialization failed');
  }

  injectRoutes(_app: Application): void {
    // Not called if initialization fails
  }
}

// ============================================================================
// Test Suite: PluginManager Lifecycle
// ============================================================================

describe('PluginManager Lifecycle', () => {
  let app: Application;
  let context: PluginContext;
  let manager: PluginManager;

  beforeEach(() => {
    app = express();
    context = {
      environment: 'test',
      port: 5001,
      config: {},
    };
    manager = new PluginManager(app, context);
  });

  test('should register plugins in order', () => {
    const plugin1 = new MockPlugin('plugin1');
    const plugin2 = new MockPlugin('plugin2');

    manager.register(plugin1);
    manager.register(plugin2);

    expect(manager.getPluginNames()).toEqual(['plugin1', 'plugin2']);
  });

  test('should prevent duplicate plugin registration', () => {
    const plugin = new MockPlugin('test');

    manager.register(plugin);
    expect(() => manager.register(plugin)).toThrow('already registered');
  });

  test('should initialize plugins in registration order', async () => {
    const initOrder: string[] = [];
    const plugin1 = new MockPlugin('p1', () => initOrder.push('p1'));
    const plugin2 = new MockPlugin('p2', () => initOrder.push('p2'));

    manager.register(plugin1);
    manager.register(plugin2);
    await manager.initialize();

    expect(initOrder).toEqual(['p1', 'p2']);
    expect(plugin1.initialized).toBe(true);
    expect(plugin2.initialized).toBe(true);
  });

  test('should inject routes after initialization', async () => {
    const plugin = new MockPlugin('test');

    manager.register(plugin);
    await manager.initialize();
    await manager.injectAllRoutes();

    expect(plugin.routesInjected).toBe(true);
  });

  test('should throw if route injection attempted before initialization', async () => {
    const plugin = new MockPlugin('test');

    manager.register(plugin);
    // Don't call initialize()

    await expect(manager.injectAllRoutes()).rejects.toThrow(
      'Cannot inject routes from uninitialized plugin'
    );
  });

  test('should shutdown plugins in reverse order', async () => {
    const shutdownOrder: string[] = [];
    const plugin1 = new MockPlugin('p1', undefined, () => shutdownOrder.push('p1'));
    const plugin2 = new MockPlugin('p2', undefined, () => shutdownOrder.push('p2'));

    manager.register(plugin1);
    manager.register(plugin2);
    await manager.initialize();
    await manager.shutdown();

    // Should shutdown in reverse registration order
    expect(shutdownOrder).toEqual(['p2', 'p1']);
  });

  test('should handle initialization failure', async () => {
    const failingPlugin = new FailingPlugin();
    manager.register(failingPlugin);

    await expect(manager.initialize()).rejects.toThrow('Plugin initialization failed');
  });

  test('should get plugin by name', () => {
    const plugin = new MockPlugin('test');
    manager.register(plugin);

    expect(manager.getPlugin('test')).toBe(plugin);
    expect(manager.getPlugin('nonexistent')).toBeUndefined();
  });

  test('should check if plugin exists', () => {
    const plugin = new MockPlugin('test');
    manager.register(plugin);

    expect(manager.hasPlugin('test')).toBe(true);
    expect(manager.hasPlugin('nonexistent')).toBe(false);
  });

  test('should skip double initialization', async () => {
    const plugin = new MockPlugin('test');
    let initCount = 0;
    plugin.initialize = async () => {
      initCount++;
      plugin.initialized = true;
    };

    manager.register(plugin);
    await manager.initialize();
    await manager.initialize(); // Second call

    expect(initCount).toBe(1); // Should only initialize once
  });

  test('should skip double route injection', async () => {
    const plugin = new MockPlugin('test');
    let injectCount = 0;
    plugin.injectRoutes = () => {
      injectCount++;
      plugin.routesInjected = true;
    };

    manager.register(plugin);
    await manager.initialize();
    await manager.injectAllRoutes();
    await manager.injectAllRoutes(); // Second call

    expect(injectCount).toBe(1); // Should only inject once
  });
});

// ============================================================================
// Test Suite: AgentPlugin
// ============================================================================

describe('AgentPlugin', () => {
  // Save original environment
  const originalEnv = process.env.DATABRICKS_HOST;

  beforeAll(() => {
    // Set required environment variables for tests
    if (!process.env.DATABRICKS_HOST) {
      process.env.DATABRICKS_HOST = 'https://test.cloud.databricks.com';
    }
  });

  afterAll(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.DATABRICKS_HOST = originalEnv;
    } else {
      delete process.env.DATABRICKS_HOST;
    }
  });

  test('should create with default configuration', () => {
    const plugin = new AgentPlugin({
      agentConfig: {
        model: 'test-model',
        temperature: 0,
      },
    });

    expect(plugin.name).toBe('agent');
    expect(plugin.version).toBeDefined();
  });

  test.skip('should initialize MLflow tracing and create agent', async () => {
    // Skip if no Databricks credentials configured
    if (!process.env.DATABRICKS_TOKEN && !process.env.DATABRICKS_CLIENT_ID) {
      console.log('[SKIP] No Databricks credentials - skipping AgentPlugin initialization test');
      return;
    }

    const plugin = new AgentPlugin({
      agentConfig: {
        model: process.env.DATABRICKS_MODEL || 'databricks-claude-sonnet-4-5',
        temperature: 0,
      },
      serviceName: 'test-agent',
    });

    await plugin.initialize();

    // Agent should be created
    expect(plugin['agent']).toBeDefined();

    // Tracing should be initialized
    expect(plugin['tracing']).toBeDefined();
  }, 30000); // Longer timeout for agent initialization

  test.skip('should inject /health and /invocations routes', async () => {
    // Skip if no Databricks credentials configured
    if (!process.env.DATABRICKS_TOKEN && !process.env.DATABRICKS_CLIENT_ID) {
      console.log('[SKIP] No Databricks credentials - skipping route injection test');
      return;
    }

    const app = express();
    const plugin = new AgentPlugin({
      agentConfig: {
        model: process.env.DATABRICKS_MODEL || 'databricks-claude-sonnet-4-5',
        temperature: 0,
      },
    });

    await plugin.initialize();
    plugin.injectRoutes(app);

    // Make a test request to /health to verify route was injected
    const testServer = app.listen(0); // Random port
    const address = testServer.address();
    const port = typeof address === 'object' ? address?.port : 0;

    try {
      const response = await fetch(`http://localhost:${port}/health`);
      expect(response.ok).toBe(true);

      const data = await response.json() as any;
      expect(data.status).toBe('healthy');
      expect(data.plugin).toBe('agent');
    } finally {
      testServer.close();
    }
  }, 30000);

  test('should handle initialization failure gracefully', async () => {
    const plugin = new AgentPlugin({
      agentConfig: {
        model: 'nonexistent-model',
        temperature: 0,
      },
    });

    // Should throw during initialization
    await expect(plugin.initialize()).rejects.toThrow();
  });

  test.skip('should shutdown gracefully', async () => {
    // Skip if no Databricks credentials configured
    if (!process.env.DATABRICKS_TOKEN && !process.env.DATABRICKS_CLIENT_ID) {
      console.log('[SKIP] No Databricks credentials - skipping shutdown test');
      return;
    }

    const plugin = new AgentPlugin({
      agentConfig: {
        model: process.env.DATABRICKS_MODEL || 'databricks-claude-sonnet-4-5',
        temperature: 0,
      },
    });

    await plugin.initialize();
    await expect(plugin.shutdown()).resolves.not.toThrow();
  }, 30000);
});

// ============================================================================
// Test Suite: UIPlugin
// ============================================================================

describe('UIPlugin', () => {
  test('should create with default configuration', () => {
    const plugin = new UIPlugin();

    expect(plugin.name).toBe('ui');
    expect(plugin.version).toBeDefined();
  });

  test('should initialize without UI routes', async () => {
    const plugin = new UIPlugin({
      uiRoutesPath: './nonexistent-path.js',
    });

    // Should not throw, just log warning
    await expect(plugin.initialize()).resolves.not.toThrow();

    // UI routes should be null
    expect(plugin['uiRoutes']).toBeNull();
  });

  test('should inject middleware and proxy routes', async () => {
    const app = express();
    const plugin = new UIPlugin({
      isDevelopment: true,
      agentInvocationsUrl: 'http://localhost:5001/invocations',
      uiRoutesPath: './nonexistent-path.js', // Routes won't load
    });

    await plugin.initialize();
    plugin.injectRoutes(app);

    // Make a test request to /ping to verify route was injected
    const testServer = app.listen(0); // Random port
    const address = testServer.address();
    const port = typeof address === 'object' ? address?.port : 0;

    try {
      const response = await fetch(`http://localhost:${port}/ping`);
      expect(response.ok).toBe(true);

      const text = await response.text();
      expect(text).toBe('pong');
    } finally {
      testServer.close();
    }
  });

  test('should configure CORS in development mode', async () => {
    const app = express();
    const plugin = new UIPlugin({
      isDevelopment: true,
    });

    await plugin.initialize();
    plugin.injectRoutes(app);

    // Just verify plugin initialized and routes injected without error
    expect(plugin['uiRoutes']).toBeNull(); // Routes won't load with default path
  });

  test('should shutdown gracefully', async () => {
    const plugin = new UIPlugin();

    await plugin.initialize();
    await expect(plugin.shutdown()).resolves.not.toThrow();
  });

  test('should handle static files configuration', async () => {
    const app = express();
    const plugin = new UIPlugin({
      isDevelopment: false,
      staticFilesPath: './nonexistent-static-path',
    });

    await plugin.initialize();
    plugin.injectRoutes(app);

    // Should not throw, just log warning
    // Static files won't be served if path doesn't exist
  });
});

// ============================================================================
// Test Suite: Plugin Integration
// ============================================================================

describe('Plugin Integration', () => {
  test('should work with multiple plugins registered', async () => {
    const app = express();
    const context: PluginContext = {
      environment: 'test',
      port: 5001,
      config: {},
    };
    const manager = new PluginManager(app, context);

    const plugin1 = new MockPlugin('plugin1');
    const plugin2 = new MockPlugin('plugin2');

    manager.register(plugin1);
    manager.register(plugin2);

    await manager.initialize();
    await manager.injectAllRoutes();

    expect(plugin1.initialized).toBe(true);
    expect(plugin2.initialized).toBe(true);
    expect(plugin1.routesInjected).toBe(true);
    expect(plugin2.routesInjected).toBe(true);
  });

  test('should continue shutdown even if one plugin fails', async () => {
    const app = express();
    const context: PluginContext = {
      environment: 'test',
      port: 5001,
      config: {},
    };
    const manager = new PluginManager(app, context);

    const shutdownOrder: string[] = [];

    const plugin1 = new MockPlugin('p1', undefined, () => {
      shutdownOrder.push('p1');
      throw new Error('Shutdown failed');
    });
    const plugin2 = new MockPlugin('p2', undefined, () => {
      shutdownOrder.push('p2');
    });

    manager.register(plugin1);
    manager.register(plugin2);

    await manager.initialize();
    await manager.shutdown();

    // Should shutdown both plugins even if first one fails
    expect(shutdownOrder).toEqual(['p2', 'p1']);
  });
});
