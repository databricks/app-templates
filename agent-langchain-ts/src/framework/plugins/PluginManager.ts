import { Application } from 'express';
import { Plugin, PluginMetadata } from './Plugin.js';

/**
 * Manages the lifecycle of plugins in the application.
 * Handles plugin registration, initialization, route injection, and shutdown.
 */
export class PluginManager {
  private plugins: Map<string, PluginMetadata> = new Map();
  private app: Application;
  private shutdownHandlersRegistered = false;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Register a plugin with the manager.
   * Must be called before initialize().
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    console.log(`[PluginManager] Registering plugin: ${plugin.name} v${plugin.version}`);

    this.plugins.set(plugin.name, {
      plugin,
      initialized: false,
      routesInjected: false,
    });
  }

  /**
   * Initialize all registered plugins in registration order.
   * Should be called after all plugins are registered.
   */
  async initialize(): Promise<void> {
    console.log('[PluginManager] Initializing plugins...');

    for (const [name, metadata] of this.plugins.entries()) {
      if (metadata.initialized) {
        console.warn(`[PluginManager] Plugin "${name}" already initialized, skipping`);
        continue;
      }

      console.log(`[PluginManager] Initializing plugin: ${name}`);
      try {
        await metadata.plugin.initialize();
        metadata.initialized = true;
        console.log(`[PluginManager] ✓ Plugin "${name}" initialized successfully`);
      } catch (error) {
        console.error(`[PluginManager] ✗ Failed to initialize plugin "${name}":`, error);
        throw new Error(`Plugin initialization failed: ${name}`);
      }
    }

    console.log('[PluginManager] All plugins initialized');

    // Register shutdown handlers after successful initialization
    // This ensures clean shutdown even if route injection fails later
    if (!this.shutdownHandlersRegistered) {
      this.registerShutdownHandlers();
      this.shutdownHandlersRegistered = true;
    }
  }

  /**
   * Inject routes from all initialized plugins.
   * Should be called after initialize().
   */
  async injectAllRoutes(): Promise<void> {
    console.log('[PluginManager] Injecting routes from plugins...');

    for (const [name, metadata] of this.plugins.entries()) {
      if (!metadata.initialized) {
        throw new Error(`Cannot inject routes from uninitialized plugin: ${name}`);
      }

      if (metadata.routesInjected) {
        console.warn(`[PluginManager] Routes already injected for plugin "${name}", skipping`);
        continue;
      }

      console.log(`[PluginManager] Injecting routes from plugin: ${name}`);
      try {
        metadata.plugin.injectRoutes(this.app);
        metadata.routesInjected = true;
        console.log(`[PluginManager] ✓ Routes injected from plugin "${name}"`);
      } catch (error) {
        console.error(`[PluginManager] ✗ Failed to inject routes from plugin "${name}":`, error);
        throw new Error(`Route injection failed: ${name}`);
      }
    }

    console.log('[PluginManager] All routes injected');
  }

  /**
   * Gracefully shutdown all plugins in reverse order.
   */
  async shutdown(): Promise<void> {
    console.log('[PluginManager] Shutting down plugins...');

    // Shutdown in reverse registration order
    const pluginsArray = Array.from(this.plugins.entries()).reverse();

    for (const [name, metadata] of pluginsArray) {
      if (!metadata.plugin.shutdown) {
        console.log(`[PluginManager] Plugin "${name}" has no shutdown hook, skipping`);
        continue;
      }

      console.log(`[PluginManager] Shutting down plugin: ${name}`);
      try {
        await metadata.plugin.shutdown();
        console.log(`[PluginManager] ✓ Plugin "${name}" shutdown successfully`);
      } catch (error) {
        console.error(`[PluginManager] ✗ Failed to shutdown plugin "${name}":`, error);
        // Continue shutting down other plugins even if one fails
      }
    }

    console.log('[PluginManager] All plugins shutdown');
  }

  /**
   * Get a registered plugin by name.
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  /**
   * Get all registered plugin names.
   */
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Check if a plugin is registered.
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Register process shutdown handlers for graceful cleanup.
   */
  private registerShutdownHandlers(): void {
    const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

    shutdownSignals.forEach((signal) => {
      process.on(signal, async () => {
        console.log(`\n[PluginManager] Received ${signal}, initiating graceful shutdown...`);
        try {
          await this.shutdown();
          process.exit(0);
        } catch (error) {
          console.error('[PluginManager] Error during shutdown:', error);
          process.exit(1);
        }
      });
    });

    // Handle uncaught errors
    process.on('uncaughtException', async (error) => {
      console.error('[PluginManager] Uncaught exception:', error);
      try {
        await this.shutdown();
      } catch (shutdownError) {
        console.error('[PluginManager] Error during emergency shutdown:', shutdownError);
      }
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      console.error('[PluginManager] Unhandled rejection at:', promise, 'reason:', reason);
      try {
        await this.shutdown();
      } catch (shutdownError) {
        console.error('[PluginManager] Error during emergency shutdown:', shutdownError);
      }
      process.exit(1);
    });
  }
}
