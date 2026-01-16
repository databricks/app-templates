import { expect, test } from '@playwright/test';
import {
  isCredentialErrorMessage,
  findLoginURLFromCredentialErrorMessage,
  findConnectionNameFromCredentialErrorMessage,
} from '../../client/src/lib/oauth-error-utils';

/**
 * Example OAuth credential error message from Databricks.
 * This is the actual format returned when a tool call requires OAuth but user hasn't authenticated.
 */
const SAMPLE_OAUTH_ERROR = `Failed request to https://example.databricks.com/api/2.0/some-endpoint
Error: Credential for user identity('user@example.com') is not found for the connection 'slack_no_auth_per_user'. Please login first to the connection by visiting https://example.databricks.com/oauth/connect?connection_name=slack_no_auth_per_user`;

const SAMPLE_OAUTH_ERROR_DIFFERENT_CONNECTION = `Failed request to https://example.databricks.com/api/endpoint
Error: Credential for user identity('admin@corp.com') is not found for the connection 'github_oauth'. Please login first to the connection by visiting https://oauth.databricks.com/login?conn=github_oauth`;

test.describe('OAuth Error Utils', () => {
  test.describe('isCredentialErrorMessage', () => {
    test('returns true for valid OAuth credential error message', () => {
      expect(isCredentialErrorMessage(SAMPLE_OAUTH_ERROR)).toBe(true);
    });

    test('returns true for different connection names and user identities', () => {
      expect(
        isCredentialErrorMessage(SAMPLE_OAUTH_ERROR_DIFFERENT_CONNECTION),
      ).toBe(true);
    });

    test('returns true with different casing', () => {
      const upperCase =
        "CREDENTIAL FOR USER IDENTITY('test@test.com') IS NOT FOUND FOR THE CONNECTION 'test'";
      expect(isCredentialErrorMessage(upperCase)).toBe(true);
    });

    test('returns false for regular error messages', () => {
      expect(isCredentialErrorMessage('Something went wrong')).toBe(false);
      expect(isCredentialErrorMessage('Network error')).toBe(false);
      expect(isCredentialErrorMessage('Connection refused')).toBe(false);
      expect(isCredentialErrorMessage('')).toBe(false);
    });

    test('returns false for partial matches', () => {
      // Missing "for the connection" part
      expect(
        isCredentialErrorMessage(
          "Credential for user identity('test@test.com') is not found",
        ),
      ).toBe(false);

      // Missing user identity format
      expect(
        isCredentialErrorMessage(
          "Credential is not found for the connection 'test'",
        ),
      ).toBe(false);
    });

    test('returns false for similar but non-OAuth errors', () => {
      expect(
        isCredentialErrorMessage('Your credentials have expired'),
      ).toBe(false);
      expect(
        isCredentialErrorMessage('Invalid connection credentials'),
      ).toBe(false);
    });
  });

  test.describe('findLoginURLFromCredentialErrorMessage', () => {
    test('extracts HTTPS login URL from error message', () => {
      const url = findLoginURLFromCredentialErrorMessage(SAMPLE_OAUTH_ERROR);
      expect(url).toBe(
        'https://example.databricks.com/oauth/connect?connection_name=slack_no_auth_per_user',
      );
    });

    test('extracts login URL with different path and query params', () => {
      const url = findLoginURLFromCredentialErrorMessage(
        SAMPLE_OAUTH_ERROR_DIFFERENT_CONNECTION,
      );
      expect(url).toBe('https://oauth.databricks.com/login?conn=github_oauth');
    });

    test('handles HTTP URLs', () => {
      const httpError =
        "Credential for user identity('test') is not found for the connection 'test'. Please login first to the connection by visiting http://localhost:8080/oauth";
      const url = findLoginURLFromCredentialErrorMessage(httpError);
      expect(url).toBe('http://localhost:8080/oauth');
    });

    test('returns undefined when no URL is present', () => {
      const noUrlError =
        "Credential for user identity('test@test.com') is not found for the connection 'test'";
      expect(findLoginURLFromCredentialErrorMessage(noUrlError)).toBeUndefined();
    });

    test('returns undefined for non-OAuth errors', () => {
      expect(
        findLoginURLFromCredentialErrorMessage('Something went wrong'),
      ).toBeUndefined();
      expect(findLoginURLFromCredentialErrorMessage('')).toBeUndefined();
    });

    test('handles URLs with complex query parameters', () => {
      const complexError =
        "Credential for user identity('user') is not found for the connection 'test'. Please login first to the connection by visiting https://example.com/oauth?param1=value1&param2=value2&redirect=https%3A%2F%2Fapp.com";
      const url = findLoginURLFromCredentialErrorMessage(complexError);
      expect(url).toBe(
        'https://example.com/oauth?param1=value1&param2=value2&redirect=https%3A%2F%2Fapp.com',
      );
    });

    test('is case insensitive for the pattern', () => {
      const upperCaseError =
        "Error. PLEASE LOGIN FIRST TO THE CONNECTION BY VISITING https://example.com/login";
      const url = findLoginURLFromCredentialErrorMessage(upperCaseError);
      expect(url).toBe('https://example.com/login');
    });
  });

  test.describe('findConnectionNameFromCredentialErrorMessage', () => {
    test('extracts connection name from error message', () => {
      const connectionName =
        findConnectionNameFromCredentialErrorMessage(SAMPLE_OAUTH_ERROR);
      expect(connectionName).toBe('slack_no_auth_per_user');
    });

    test('extracts different connection names', () => {
      const connectionName = findConnectionNameFromCredentialErrorMessage(
        SAMPLE_OAUTH_ERROR_DIFFERENT_CONNECTION,
      );
      expect(connectionName).toBe('github_oauth');
    });

    test('handles connection names with special characters', () => {
      const specialError =
        "Credential for user identity('user') is not found for the connection 'my-connection_v2.0'";
      const connectionName =
        findConnectionNameFromCredentialErrorMessage(specialError);
      expect(connectionName).toBe('my-connection_v2.0');
    });

    test('returns undefined when no connection name is present', () => {
      const noConnectionError =
        "Credential for user identity('test@test.com') is not found";
      expect(
        findConnectionNameFromCredentialErrorMessage(noConnectionError),
      ).toBeUndefined();
    });

    test('returns undefined for non-OAuth errors', () => {
      expect(
        findConnectionNameFromCredentialErrorMessage('Something went wrong'),
      ).toBeUndefined();
      expect(
        findConnectionNameFromCredentialErrorMessage(''),
      ).toBeUndefined();
    });

    test('is case insensitive for the pattern', () => {
      const upperCaseError =
        "Error. FOR THE CONNECTION 'MyConnection' please login";
      const connectionName =
        findConnectionNameFromCredentialErrorMessage(upperCaseError);
      expect(connectionName).toBe('MyConnection');
    });

    test('handles connection names with spaces (edge case)', () => {
      // Connection names typically don't have spaces, but test the boundary
      const spaceError =
        "Credential for user identity('user') is not found for the connection 'Connection Name'";
      const connectionName =
        findConnectionNameFromCredentialErrorMessage(spaceError);
      expect(connectionName).toBe('Connection Name');
    });
  });

  test.describe('Integration - parsing full error messages', () => {
    test('extracts all components from a complete OAuth error', () => {
      expect(isCredentialErrorMessage(SAMPLE_OAUTH_ERROR)).toBe(true);
      expect(findConnectionNameFromCredentialErrorMessage(SAMPLE_OAUTH_ERROR)).toBe(
        'slack_no_auth_per_user',
      );
      expect(findLoginURLFromCredentialErrorMessage(SAMPLE_OAUTH_ERROR)).toBe(
        'https://example.databricks.com/oauth/connect?connection_name=slack_no_auth_per_user',
      );
    });

    test('handles multiline error messages', () => {
      const multilineError = `Error occurred during tool execution.
Credential for user identity('test@example.com') is not found for the connection 'jira_oauth'.
Please login first to the connection by visiting https://auth.databricks.com/jira-login
Additional context: Tool call failed.`;

      expect(isCredentialErrorMessage(multilineError)).toBe(true);
      expect(findConnectionNameFromCredentialErrorMessage(multilineError)).toBe(
        'jira_oauth',
      );
      expect(findLoginURLFromCredentialErrorMessage(multilineError)).toBe(
        'https://auth.databricks.com/jira-login',
      );
    });
  });
});
