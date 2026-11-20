/**
 * Utility functions for OAuth credential error detection and parsing.
 *
 * These functions detect and parse error messages returned when a tool call
 * requires OAuth authentication that the user hasn't completed yet.
 *
 * Expected error format:
 * "Failed request to https://... Error: Credential for user identity('___') is not found
 * for the connection 'CONNECTION_NAME'. Please login first to the connection by visiting https://LOGIN_URL"
 */

/**
 * Checks if an error message indicates a credential/OAuth error.
 * Pattern: "Credential for user identity('___') is not found for the connection '___'"
 */
export function isCredentialErrorMessage(errorMessage: string): boolean {
  const pattern =
    /Credential for user identity\([^)]*\) is not found for the connection/i;
  return pattern.test(errorMessage);
}

/**
 * Extracts the login URL from a credential error message.
 * Pattern: "please login first to the connection by visiting https://..."
 * @returns The login URL or undefined if not found
 */
export function findLoginURLFromCredentialErrorMessage(
  errorMessage: string,
): string | undefined {
  const pattern =
    /please login first to the connection by visiting\s+(https?:\/\/[^\s]+)/i;
  const match = errorMessage.match(pattern);
  return match?.[1];
}

/**
 * The login URL is parsed from error text that may contain model or tool
 * output, so only https links to the Databricks workspace (or this app's own
 * origin) may be opened.
 */
export function isTrustedLoginURL(
  url: string,
  workspaceHost: string | undefined,
  appHost: string = window.location.host,
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.host.toLowerCase();
    return (
      host === appHost.toLowerCase() ||
      (!!workspaceHost && host === workspaceHost.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * Extracts the connection name from a credential error message.
 * Pattern: "for the connection 'connection_name'"
 * @returns The connection name or undefined if not found
 */
export function findConnectionNameFromCredentialErrorMessage(
  errorMessage: string,
): string | undefined {
  const pattern = /for the connection\s+'([^']+)'/i;
  const match = errorMessage.match(pattern);
  return match?.[1];
}
