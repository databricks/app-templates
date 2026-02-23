import { Application } from 'express';

/**
 * FRAMEWORK FILE - You do not need to modify this file.
 *
 * Defines the Plugin interface and types used by PluginManager.
 * Modify src/agent.ts, src/tools.ts, or src/mcp-servers.ts instead.
 *
 * Core plugin interface that all plugins must implement.
 * Inspired by AppKit's plugin-based architecture.
 */
export interface Plugin {
  /** Unique identifier for the plugin */
  name: string;

  /** Semantic version of the plugin */
  version: string;

  /**
   * Initialize the plugin. Called before route injection.
   * Use this for setup tasks like database connections, agent creation, etc.
   */
  initialize(): Promise<void>;

  /**
   * Inject routes into the Express application.
   * Called after all plugins are initialized.
   */
  injectRoutes(app: Application): void;

  /**
   * Optional cleanup hook called during graceful shutdown.
   */
  shutdown?(): Promise<void>;
}

/**
 * Configuration passed when creating a plugin.
 */
export interface PluginConfig {
  [key: string]: any;
}

/**
 * Plugin metadata for registration.
 */
export interface PluginMetadata {
  /** Plugin instance */
  plugin: Plugin;

  /** Whether the plugin has been initialized */
  initialized: boolean;

  /** Whether the plugin's routes have been injected */
  routesInjected: boolean;
}
