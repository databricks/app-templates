/**
 * Utility functions for handling Databricks host URLs
 */

/**
 * Normalize Databricks host URL to ensure consistent format
 * Supports both formats:
 * - https://workspace.cloud.databricks.com/ (with protocol)
 * - workspace.cloud.databricks.com (without protocol)
 */
function normalizeHost(host: string | undefined): string {
  if (!host) {
    throw new Error(
      'Databricks host configuration required. Please set either:\n' +
        '- DATABRICKS_HOST environment variable\n' +
        '- DATABRICKS_CONFIG_PROFILE environment variable (with "databricks auth login" configured)',
    );
  }

  // Remove protocol and trailing slash if present
  return host.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Get the full HTTPS URL for a Databricks host
 */
export function getHostUrl(host?: string): string {
  const normalizedHost = normalizeHost(host || process.env.DATABRICKS_HOST);
  return `https://${normalizedHost}`;
}

/**
 * Get the normalized host without protocol
 */
export function getHostDomain(host?: string): string {
  return normalizeHost(host || process.env.DATABRICKS_HOST);
}
