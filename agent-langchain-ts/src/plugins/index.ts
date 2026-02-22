/**
 * Plugin System
 *
 * A flexible plugin-based architecture inspired by Databricks AppKit.
 * Allows the server to be composed of independent, reusable plugins.
 */

export { Plugin, PluginContext, PluginConfig, PluginMetadata } from './Plugin.js';
export { PluginManager } from './PluginManager.js';
