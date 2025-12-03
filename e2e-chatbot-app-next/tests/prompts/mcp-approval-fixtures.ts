import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';

/**
 * MCP Approval Request/Response Fixtures
 *
 * These fixtures simulate the SSE stream for MCP approval flows.
 */

/**
 * Fixture: MCP Approval Request followed by text response (pending state)
 *
 * This simulates a stream where the model requests approval for an MCP tool call.
 * The response pauses after sending the approval request, waiting for user input.
 */
export const MCP_APPROVAL_REQUEST_FIXTURE: LLMOutputFixtures = {
  in: `
data: {
    "response": {
        "id": "__fake_id__response_created__",
        "created_at": 1761660865.178889,
        "error": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": []
    },
    "sequence_number": 0,
    "type": "response.created"
}

data: {
    "item": {
        "id": "__fake_id__response_item__",
        "content": [],
        "role": "assistant",
        "status": "in_progress",
        "type": "message"
    },
    "output_index": 0,
    "sequence_number": 1,
    "type": "response.output_item.added"
}

data: {
    "content_index": 0,
    "item_id": "__fake_id__response_content_part__",
    "output_index": 0,
    "part": {"annotations": [], "text": "", "type": "output_text", "logprobs": null},
    "sequence_number": 2,
    "type": "response.content_part.added"
}

data: {
    "content_index": 0,
    "delta": "I'll help you with that.",
    "item_id": "__fake_id__text_1__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 3,
    "type": "response.output_text.delta"
}

data: {
    "content_index": 0,
    "item_id": "__fake_id__response_content_part__",
    "output_index": 0,
    "part": {
        "annotations": [],
        "text": "I'll help you with that.",
        "type": "output_text",
        "logprobs": null
    },
    "sequence_number": 4,
    "type": "response.content_part.done"
}

data: {
    "item": {
        "type": "mcp_approval_request",
        "id": "__fake_mcp_request_id__",
        "name": "test_mcp_tool",
        "arguments": "{\\"action\\": \\"test\\", \\"param\\": \\"value\\"}",
        "server_label": "test-server"
    },
    "output_index": 1,
    "sequence_number": 5,
    "type": "response.output_item.done"
}

data: {
    "item": {
        "id": "__fake_id__text_1__",
        "content": [
            {
                "annotations": [],
                "text": "I'll help you with that.",
                "type": "output_text",
                "logprobs": null
            }
        ],
        "role": "assistant",
        "status": "completed",
        "type": "message"
    },
    "output_index": 0,
    "sequence_number": 6,
    "type": "response.output_item.done"
}

data: {
    "response": {
        "id": "__fake_id__response_completed__",
        "created_at": 1761660865.178889,
        "error": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": [
            {
                "id": "__fake_id__text_1__",
                "content": [
                    {
                        "annotations": [],
                        "text": "I'll help you with that.",
                        "type": "output_text",
                        "logprobs": null
                    }
                ],
                "role": "assistant",
                "status": "completed",
                "type": "message"
            },
            {
                "type": "mcp_approval_request",
                "id": "__fake_mcp_request_id__",
                "name": "test_mcp_tool",
                "arguments": "{\\"action\\": \\"test\\", \\"param\\": \\"value\\"}",
                "server_label": "test-server"
            }
        ],
        "usage": {
            "input_tokens": 100,
            "output_tokens": 50,
            "total_tokens": 150
        }
    },
    "sequence_number": 7,
    "type": "response.completed"
}
`,
  out: [
    // Text message: "I'll help you with that."
    { type: 'text-start', id: '__fake_id__text_1__' },
    {
      type: 'text-delta',
      id: '__fake_id__text_1__',
      delta: "I'll help you with that.",
      providerMetadata: { databricks: { itemId: '__fake_id__text_1__' } },
    },
    { type: 'text-end', id: '__fake_id__text_1__' },
    // MCP approval request
    {
      type: 'tool-call',
      toolCallId: '__fake_mcp_request_id__',
      toolName: 'databricks-tool-call',
      input: '{"action": "test", "param": "value"}',
      providerMetadata: {
        databricks: {
          type: 'mcp_approval_request',
          toolName: 'test_mcp_tool',
          itemId: '__fake_mcp_request_id__',
          serverLabel: 'test-server',
        },
      },
    },
  ],
};

/**
 * Fixture: MCP Approval Response (approved)
 *
 * This simulates the continuation after user approves the MCP tool call.
 */
export const MCP_APPROVAL_RESPONSE_APPROVED_FIXTURE: LLMOutputFixtures = {
  in: `
data: {
    "response": {
        "id": "__fake_id__response_created__",
        "created_at": 1761660870.595438,
        "error": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": []
    },
    "sequence_number": 0,
    "type": "response.created"
}

data: {
    "item": {
        "type": "mcp_approval_response",
        "id": "__fake_mcp_response_id__",
        "approval_request_id": "__fake_mcp_request_id__",
        "approve": true,
        "reason": null
    },
    "output_index": 0,
    "sequence_number": 1,
    "type": "response.output_item.done"
}

data: {
    "item": {
        "id": "__fake_id__response_item__",
        "content": [],
        "role": "assistant",
        "status": "in_progress",
        "type": "message"
    },
    "output_index": 1,
    "sequence_number": 2,
    "type": "response.output_item.added"
}

data: {
    "content_index": 0,
    "delta": "The tool has been executed.",
    "item_id": "__fake_id__text_2__",
    "logprobs": [],
    "output_index": 1,
    "sequence_number": 3,
    "type": "response.output_text.delta"
}

data: {
    "item": {
        "id": "__fake_id__text_2__",
        "content": [
            {
                "annotations": [],
                "text": "The tool has been executed.",
                "type": "output_text",
                "logprobs": null
            }
        ],
        "role": "assistant",
        "status": "completed",
        "type": "message"
    },
    "output_index": 1,
    "sequence_number": 4,
    "type": "response.output_item.done"
}

data: {
    "response": {
        "id": "__fake_id__response_completed__",
        "created_at": 1761660870.595438,
        "error": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": [
            {
                "type": "mcp_approval_response",
                "id": "__fake_mcp_response_id__",
                "approval_request_id": "__fake_mcp_request_id__",
                "approve": true,
                "reason": null
            },
            {
                "id": "__fake_id__text_2__",
                "content": [
                    {
                        "annotations": [],
                        "text": "The tool has been executed.",
                        "type": "output_text",
                        "logprobs": null
                    }
                ],
                "role": "assistant",
                "status": "completed",
                "type": "message"
            }
        ],
        "usage": {
            "input_tokens": 150,
            "output_tokens": 30,
            "total_tokens": 180
        }
    },
    "sequence_number": 5,
    "type": "response.completed"
}
`,
  out: [
    // Tool-call re-emitted from prompt (needed before tool-result)
    {
      type: 'tool-call',
      toolCallId: '__fake_mcp_request_id__',
      toolName: 'databricks-tool-call',
      input: '{"action":"test","param":"value"}',
    },
    // MCP approval response (approved)
    {
      type: 'tool-result',
      toolCallId: '__fake_mcp_request_id__',
      toolName: 'databricks-tool-call',
      result: { __approvalStatus__: true },
      providerMetadata: {
        databricks: {
          type: 'mcp_approval_response',
          itemId: '__fake_mcp_response_id__',
        },
      },
    },
    // Text message: "The tool has been executed."
    { type: 'text-start', id: '__fake_id__text_2__' },
    {
      type: 'text-delta',
      id: '__fake_id__text_2__',
      delta: 'The tool has been executed.',
      providerMetadata: { databricks: { itemId: '__fake_id__text_2__' } },
    },
    { type: 'text-end', id: '__fake_id__text_2__' },
  ],
};

/**
 * Fixture: MCP Approval Response (denied)
 *
 * This simulates the continuation after user denies the MCP tool call.
 */
export const MCP_APPROVAL_RESPONSE_DENIED_FIXTURE: LLMOutputFixtures = {
  in: `
data: {
    "response": {
        "id": "__fake_id__response_created__",
        "created_at": 1761660870.595438,
        "error": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": []
    },
    "sequence_number": 0,
    "type": "response.created"
}

data: {
    "item": {
        "type": "mcp_approval_response",
        "id": "__fake_mcp_response_denied_id__",
        "approval_request_id": "__fake_mcp_request_id__",
        "approve": false,
        "reason": "User denied the request"
    },
    "output_index": 0,
    "sequence_number": 1,
    "type": "response.output_item.done"
}

data: {
    "item": {
        "id": "__fake_id__response_item__",
        "content": [],
        "role": "assistant",
        "status": "in_progress",
        "type": "message"
    },
    "output_index": 1,
    "sequence_number": 2,
    "type": "response.output_item.added"
}

data: {
    "content_index": 0,
    "delta": "I understand. I won't execute that tool.",
    "item_id": "__fake_id__text_denied__",
    "logprobs": [],
    "output_index": 1,
    "sequence_number": 3,
    "type": "response.output_text.delta"
}

data: {
    "item": {
        "id": "__fake_id__text_denied__",
        "content": [
            {
                "annotations": [],
                "text": "I understand. I won't execute that tool.",
                "type": "output_text",
                "logprobs": null
            }
        ],
        "role": "assistant",
        "status": "completed",
        "type": "message"
    },
    "output_index": 1,
    "sequence_number": 4,
    "type": "response.output_item.done"
}

data: {
    "response": {
        "id": "__fake_id__response_completed__",
        "created_at": 1761660870.595438,
        "error": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": [
            {
                "type": "mcp_approval_response",
                "id": "__fake_mcp_response_denied_id__",
                "approval_request_id": "__fake_mcp_request_id__",
                "approve": false,
                "reason": "User denied the request"
            },
            {
                "id": "__fake_id__text_denied__",
                "content": [
                    {
                        "annotations": [],
                        "text": "I understand. I won't execute that tool.",
                        "type": "output_text",
                        "logprobs": null
                    }
                ],
                "role": "assistant",
                "status": "completed",
                "type": "message"
            }
        ],
        "usage": {
            "input_tokens": 150,
            "output_tokens": 25,
            "total_tokens": 175
        }
    },
    "sequence_number": 5,
    "type": "response.completed"
}
`,
  out: [
    // Tool-call re-emitted from prompt (needed before tool-result)
    {
      type: 'tool-call',
      toolCallId: '__fake_mcp_request_id__',
      toolName: 'databricks-tool-call',
      input: '{"action":"test","param":"value"}',
    },
    // MCP approval response (denied)
    {
      type: 'tool-result',
      toolCallId: '__fake_mcp_request_id__',
      toolName: 'databricks-tool-call',
      result: { __approvalStatus__: false },
      providerMetadata: {
        databricks: {
          type: 'mcp_approval_response',
          itemId: '__fake_mcp_response_denied_id__',
        },
      },
    },
    // Text message: "I understand. I won't execute that tool."
    { type: 'text-start', id: '__fake_id__text_denied__' },
    {
      type: 'text-delta',
      id: '__fake_id__text_denied__',
      delta: "I understand. I won't execute that tool.",
      providerMetadata: { databricks: { itemId: '__fake_id__text_denied__' } },
    },
    { type: 'text-end', id: '__fake_id__text_denied__' },
  ],
};

type LLMOutputFixtures = {
  in: string;
  out: Array<LanguageModelV2StreamPart>;
};
