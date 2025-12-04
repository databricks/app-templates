/**
 * MCP Approval Utility Functions
 *
 * Shared utilities for handling MCP (Model Context Protocol) approval requests
 * and responses across client and server code.
 */

// ============================================================================
// Constants
// ============================================================================

/** Key used in tool output to indicate approval status */
export const MCP_APPROVAL_STATUS_KEY = '__approvalStatus__' as const;

/** Type string for MCP approval requests in provider metadata */
export const MCP_APPROVAL_REQUEST_TYPE = 'mcp_approval_request' as const;

/** Type string for MCP approval responses in provider metadata */
export const MCP_APPROVAL_RESPONSE_TYPE = 'mcp_approval_response' as const;

// ============================================================================
// Types
// ============================================================================

/** Approval status output object shape */
export type ApprovalStatusOutput = {
  [MCP_APPROVAL_STATUS_KEY]: boolean;
};

/** State of an MCP approval request */
export type McpApprovalState = 'awaiting-approval' | 'approved' | 'denied';

/** Databricks-specific metadata attached to tool calls */
export interface DatabricksToolMetadata {
  type?: string;
  toolName?: string;
  itemId?: string;
  serverLabel?: string;
  mcpServerName?: string;
  approvalRequestId?: string;
  approve?: boolean;
  reason?: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if output contains an approval status marker.
 *
 * @example
 * if (isApprovalStatusOutput(output)) {
 *   console.log(output.__approvalStatus__); // TypeScript knows this is boolean
 * }
 */
export function isApprovalStatusOutput(
  output: unknown,
): output is ApprovalStatusOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    MCP_APPROVAL_STATUS_KEY in output &&
    typeof (output as Record<string, unknown>)[MCP_APPROVAL_STATUS_KEY] ===
      'boolean'
  );
}

/**
 * Check if provider metadata indicates an MCP approval request.
 *
 * @example
 * const metadata = extractDatabricksMetadata(part);
 * if (isMcpApprovalRequest(metadata)) {
 *   // Handle MCP approval request
 * }
 */
export function isMcpApprovalRequest(
  metadata: DatabricksToolMetadata | Record<string, unknown> | undefined,
): boolean {
  return metadata?.type?.toString() === MCP_APPROVAL_REQUEST_TYPE;
}

/**
 * Check if provider metadata indicates an MCP approval response.
 */
export function isMcpApprovalResponse(
  metadata: DatabricksToolMetadata | Record<string, unknown> | undefined,
): boolean {
  return metadata?.type?.toString() === MCP_APPROVAL_RESPONSE_TYPE;
}

// ============================================================================
// Extractors
// ============================================================================

/**
 * Extract Databricks metadata from a tool call part's callProviderMetadata.
 *
 * @example
 * const metadata = extractDatabricksMetadata(part);
 * const toolName = metadata?.toolName;
 * const isMcp = isMcpApprovalRequest(metadata);
 */
export function extractDatabricksMetadata(part: {
  callProviderMetadata?: Record<string, unknown>;
}): DatabricksToolMetadata | undefined {
  if ('callProviderMetadata' in part && part.callProviderMetadata?.databricks) {
    return part.callProviderMetadata.databricks as DatabricksToolMetadata;
  }
  return undefined;
}

/**
 * Extract the approval status boolean from an output object.
 *
 * @returns `true` if approved, `false` if denied, `undefined` if not an approval output
 *
 * @example
 * const status = extractApprovalStatus(output);
 * if (status !== undefined) {
 *   console.log(status ? 'Approved' : 'Denied');
 * }
 */
export function extractApprovalStatus(output: unknown): boolean | undefined {
  if (isApprovalStatusOutput(output)) {
    return output[MCP_APPROVAL_STATUS_KEY];
  }
  return undefined;
}

/**
 * Extract approval status from a tool result's output value.
 * Handles the nested structure where output.type === 'json' and value contains the status.
 *
 * @example
 * const status = extractApprovalStatusFromToolResult(toolResult.output);
 */
export function extractApprovalStatusFromToolResult(output: {
  type: string;
  value?: unknown;
}): boolean | undefined {
  if (
    output.type === 'json' &&
    output.value &&
    typeof output.value === 'object' &&
    MCP_APPROVAL_STATUS_KEY in output.value
  ) {
    const value = (output.value as Record<string, unknown>)[
      MCP_APPROVAL_STATUS_KEY
    ];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

// ============================================================================
// Factories
// ============================================================================

/**
 * Create an approval status output object.
 *
 * @example
 * await addToolResult({
 *   toolCallId,
 *   output: createApprovalStatusOutput(true), // Approve
 * });
 */
export function createApprovalStatusOutput(
  approve: boolean,
): ApprovalStatusOutput {
  return { [MCP_APPROVAL_STATUS_KEY]: approve };
}

// ============================================================================
// State Helpers
// ============================================================================

/**
 * Determine the MCP approval state from a tool output.
 *
 * Logic:
 * - No output → 'awaiting-approval' (user hasn't responded yet)
 * - Output with __approvalStatus__: true → 'approved'
 * - Output with __approvalStatus__: false → 'denied'
 * - Output without __approvalStatus__ → 'approved' (tool executed, so it was approved)
 *
 * @example
 * const approvalState = getMcpApprovalState(part.output);
 * // 'awaiting-approval' | 'approved' | 'denied'
 */
export function getMcpApprovalState(output: unknown): McpApprovalState {
  if (!output) {
    return 'awaiting-approval';
  }

  const status = extractApprovalStatus(output);
  if (status === undefined) {
    // Has output but no approval marker means tool executed (was approved)
    return 'approved';
  }

  return status ? 'approved' : 'denied';
}
