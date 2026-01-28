import { expect, test } from '@playwright/test';
import {
  isApprovalStatusOutput,
  isMcpApprovalRequest,
  isMcpApprovalResponse,
  extractDatabricksMetadata,
  extractApprovalStatus,
  extractApprovalStatusFromToolResult,
  createApprovalStatusOutput,
  getMcpApprovalState,
  MCP_APPROVAL_STATUS_KEY,
  MCP_APPROVAL_REQUEST_TYPE,
  MCP_APPROVAL_RESPONSE_TYPE,
} from '../../packages/ai-sdk-providers/src/mcp-approval-utils';

test.describe('MCP Approval Utils', () => {
  test.describe('Constants', () => {
    test('MCP_APPROVAL_STATUS_KEY is correct', () => {
      expect(MCP_APPROVAL_STATUS_KEY).toBe('__approvalStatus__');
    });

    test('MCP_APPROVAL_REQUEST_TYPE is correct', () => {
      expect(MCP_APPROVAL_REQUEST_TYPE).toBe('mcp_approval_request');
    });

    test('MCP_APPROVAL_RESPONSE_TYPE is correct', () => {
      expect(MCP_APPROVAL_RESPONSE_TYPE).toBe('mcp_approval_response');
    });
  });

  test.describe('isApprovalStatusOutput', () => {
    test('returns true for valid approved output', () => {
      const output = { __approvalStatus__: true };
      expect(isApprovalStatusOutput(output)).toBe(true);
    });

    test('returns true for valid denied output', () => {
      const output = { __approvalStatus__: false };
      expect(isApprovalStatusOutput(output)).toBe(true);
    });

    test('returns false for null', () => {
      expect(isApprovalStatusOutput(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(isApprovalStatusOutput(undefined)).toBe(false);
    });

    test('returns false for non-object types', () => {
      expect(isApprovalStatusOutput('string')).toBe(false);
      expect(isApprovalStatusOutput(123)).toBe(false);
      expect(isApprovalStatusOutput(true)).toBe(false);
    });

    test('returns false for object without approval status key', () => {
      expect(isApprovalStatusOutput({ other: 'value' })).toBe(false);
      expect(isApprovalStatusOutput({})).toBe(false);
    });

    test('returns false for object with wrong type for approval status', () => {
      expect(isApprovalStatusOutput({ __approvalStatus__: 'true' })).toBe(
        false,
      );
      expect(isApprovalStatusOutput({ __approvalStatus__: 1 })).toBe(false);
      expect(isApprovalStatusOutput({ __approvalStatus__: null })).toBe(false);
    });

    test('returns true for output with additional properties', () => {
      const output = { __approvalStatus__: true, extra: 'data' };
      expect(isApprovalStatusOutput(output)).toBe(true);
    });
  });

  test.describe('isMcpApprovalRequest', () => {
    test('returns true for valid approval request metadata', () => {
      const metadata = { type: 'mcp_approval_request' };
      expect(isMcpApprovalRequest(metadata)).toBe(true);
    });

    test('returns true for metadata with additional properties', () => {
      const metadata = {
        type: 'mcp_approval_request',
        toolName: 'test-tool',
        serverLabel: 'test-server',
      };
      expect(isMcpApprovalRequest(metadata)).toBe(true);
    });

    test('returns false for undefined', () => {
      expect(isMcpApprovalRequest(undefined)).toBe(false);
    });

    test('returns false for empty object', () => {
      expect(isMcpApprovalRequest({})).toBe(false);
    });

    test('returns false for wrong type value', () => {
      expect(isMcpApprovalRequest({ type: 'function_call' })).toBe(false);
      expect(isMcpApprovalRequest({ type: 'mcp_approval_response' })).toBe(
        false,
      );
    });

    test('returns false for non-string type', () => {
      expect(isMcpApprovalRequest({ type: 123 })).toBe(false);
      expect(isMcpApprovalRequest({ type: null })).toBe(false);
    });
  });

  test.describe('isMcpApprovalResponse', () => {
    test('returns true for valid approval response metadata', () => {
      const metadata = { type: 'mcp_approval_response' };
      expect(isMcpApprovalResponse(metadata)).toBe(true);
    });

    test('returns true for metadata with additional properties', () => {
      const metadata = {
        type: 'mcp_approval_response',
        approvalRequestId: 'req-123',
        approve: true,
      };
      expect(isMcpApprovalResponse(metadata)).toBe(true);
    });

    test('returns false for undefined', () => {
      expect(isMcpApprovalResponse(undefined)).toBe(false);
    });

    test('returns false for empty object', () => {
      expect(isMcpApprovalResponse({})).toBe(false);
    });

    test('returns false for wrong type value', () => {
      expect(isMcpApprovalResponse({ type: 'function_call' })).toBe(false);
      expect(isMcpApprovalResponse({ type: 'mcp_approval_request' })).toBe(
        false,
      );
    });
  });

  test.describe('extractDatabricksMetadata', () => {
    test('extracts metadata from part with databricks metadata', () => {
      const part = {
        callProviderMetadata: {
          databricks: {
            type: 'mcp_approval_request',
            toolName: 'test-tool',
          },
        },
      };
      const metadata = extractDatabricksMetadata(part);
      expect(metadata).toEqual({
        type: 'mcp_approval_request',
        toolName: 'test-tool',
      });
    });

    test('returns undefined for part without callProviderMetadata', () => {
      const part = {};
      expect(extractDatabricksMetadata(part)).toBeUndefined();
    });

    test('returns undefined for part with callProviderMetadata but no databricks', () => {
      const part = {
        callProviderMetadata: {
          otherProvider: { data: 'value' },
        },
      };
      expect(extractDatabricksMetadata(part)).toBeUndefined();
    });

    test('returns undefined for part with undefined callProviderMetadata', () => {
      const part = { callProviderMetadata: undefined };
      expect(extractDatabricksMetadata(part)).toBeUndefined();
    });
  });

  test.describe('extractApprovalStatus', () => {
    test('returns true for approved output', () => {
      const output = { __approvalStatus__: true };
      expect(extractApprovalStatus(output)).toBe(true);
    });

    test('returns false for denied output', () => {
      const output = { __approvalStatus__: false };
      expect(extractApprovalStatus(output)).toBe(false);
    });

    test('returns undefined for non-approval output', () => {
      expect(extractApprovalStatus({ other: 'value' })).toBeUndefined();
      expect(extractApprovalStatus(null)).toBeUndefined();
      expect(extractApprovalStatus(undefined)).toBeUndefined();
      expect(extractApprovalStatus('string')).toBeUndefined();
    });
  });

  test.describe('extractApprovalStatusFromToolResult', () => {
    test('returns true for JSON output with approved status', () => {
      const output = {
        type: 'json',
        value: { __approvalStatus__: true },
      };
      expect(extractApprovalStatusFromToolResult(output)).toBe(true);
    });

    test('returns false for JSON output with denied status', () => {
      const output = {
        type: 'json',
        value: { __approvalStatus__: false },
      };
      expect(extractApprovalStatusFromToolResult(output)).toBe(false);
    });

    test('returns undefined for non-JSON type', () => {
      const output = {
        type: 'text',
        value: { __approvalStatus__: true },
      };
      expect(extractApprovalStatusFromToolResult(output)).toBeUndefined();
    });

    test('returns undefined for JSON without approval status', () => {
      const output = {
        type: 'json',
        value: { other: 'data' },
      };
      expect(extractApprovalStatusFromToolResult(output)).toBeUndefined();
    });

    test('returns undefined for JSON with undefined value', () => {
      const output = {
        type: 'json',
        value: undefined,
      };
      expect(extractApprovalStatusFromToolResult(output)).toBeUndefined();
    });

    test('returns undefined for JSON with non-object value', () => {
      const output = {
        type: 'json',
        value: 'string',
      };
      expect(extractApprovalStatusFromToolResult(output)).toBeUndefined();
    });

    test('returns undefined for JSON with wrong type for approval status', () => {
      const output = {
        type: 'json',
        value: { __approvalStatus__: 'true' },
      };
      expect(extractApprovalStatusFromToolResult(output)).toBeUndefined();
    });
  });

  test.describe('createApprovalStatusOutput', () => {
    test('creates approved output', () => {
      const output = createApprovalStatusOutput(true);
      expect(output).toEqual({ __approvalStatus__: true });
    });

    test('creates denied output', () => {
      const output = createApprovalStatusOutput(false);
      expect(output).toEqual({ __approvalStatus__: false });
    });

    test('output passes isApprovalStatusOutput check', () => {
      const approved = createApprovalStatusOutput(true);
      const denied = createApprovalStatusOutput(false);
      expect(isApprovalStatusOutput(approved)).toBe(true);
      expect(isApprovalStatusOutput(denied)).toBe(true);
    });
  });

  test.describe('getMcpApprovalState', () => {
    test('returns "awaiting-approval" for undefined', () => {
      expect(getMcpApprovalState(undefined)).toBe('awaiting-approval');
    });

    test('returns "awaiting-approval" for null', () => {
      expect(getMcpApprovalState(null)).toBe('awaiting-approval');
    });

    test('returns "approved" for output with true approval status', () => {
      const output = { __approvalStatus__: true };
      expect(getMcpApprovalState(output)).toBe('approved');
    });

    test('returns "denied" for output with false approval status', () => {
      const output = { __approvalStatus__: false };
      expect(getMcpApprovalState(output)).toBe('denied');
    });

    test('returns "approved" for output without approval status marker (actual tool output)', () => {
      const output = { result: 'tool execution result' };
      expect(getMcpApprovalState(output)).toBe('approved');
    });

    test('returns "approved" for empty object (has output but no marker)', () => {
      expect(getMcpApprovalState({})).toBe('approved');
    });

    test('returns "approved" for string output', () => {
      expect(getMcpApprovalState('tool output')).toBe('approved');
    });

    test('returns "approved" for array output', () => {
      expect(getMcpApprovalState([1, 2, 3])).toBe('approved');
    });
  });
});
