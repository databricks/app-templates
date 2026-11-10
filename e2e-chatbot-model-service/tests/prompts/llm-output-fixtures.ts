import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
/**
 * This file contains "known-good" LLM output used for testing completeness of this template and all its
 * moving parts.
 */

/**
 * # FMAPI output fixtures
 */

/**
 * # ChatAgent output fixtures
 */

/**
 * # ResponsesAgent output fixtures
 */

export const RESPONSES_AGENT_OUTPUT_WITH_TOOL_CALLS: LLMOutputFixtures = {
  in: `
data: {
    "response": {
        "id": "__fake_id__response_created__",
        "created_at": 1761660865.178889,
        "error": null,
        "incomplete_details": null,
        "instructions": null,
        "metadata": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": [],
        "parallel_tool_calls": false,
        "temperature": null,
        "tool_choice": "auto",
        "tools": [],
        "top_p": null,
        "background": null,
        "conversation": null,
        "max_output_tokens": null,
        "max_tool_calls": null,
        "previous_response_id": null,
        "prompt": null,
        "prompt_cache_key": null,
        "reasoning": null,
        "safety_identifier": null,
        "service_tier": null,
        "status": null,
        "text": null,
        "top_logprobs": null,
        "truncation": null,
        "usage": null,
        "user": null,
    },
    "sequence_number": 0,
    "type": "response.created",
}

data: {
    "item": {
        "id": "__fake_id__response_item__",
        "content": [],
        "role": "assistant",
        "status": "in_progress",
        "type": "message",
    },
    "output_index": 0,
    "sequence_number": 1,
    "type": "response.output_item.added",
}

data: {
    "content_index": 0,
    "item_id": "__fake_id__response_content_part__",
    "output_index": 0,
    "part": {"annotations": [], "text": "", "type": "output_text", "logprobs": null},
    "sequence_number": 2,
    "type": "response.content_part.added",
}

data: {
    "content_index": 0,
    "delta": "I",
    "item_id": "__fake_id__text_1__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 3,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "delta": "'ll execute",
    "item_id": "__fake_id__text_1__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 4,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "delta": " Python code to calculate",
    "item_id": "__fake_id__text_1__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 5,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "delta": " 4*",
    "item_id": "__fake_id__text_1__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 6,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "delta": "3 for",
    "item_id": "__fake_id__text_1__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 7,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "delta": " you.",
    "item_id": "__fake_id__text_1__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 8,
    "type": "response.output_text.delta",
}

data: {
    "item": {
        "arguments": "",
        "call_id": "toolu_bdrk_01LW5hc2yFFgzaebQ43jp6v6",
        "name": "system__ai__python_exec",
        "type": "function_call",
        "id": "__fake_id__tool_call__",
        "status": null,
    },
    "output_index": 1,
    "sequence_number": 9,
    "type": "response.output_item.added",
}

data: {
    "delta": '{"code": "#',
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 10,
    "type": "response.function_call_arguments.delta",
}

data: {
    "delta": " Cal",
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 11,
    "type": "response.function_call_arguments.delta",
}

data: {
    "delta": "culate",
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 12,
    "type": "response.function_call_arguments.delta",
}

data: {
    "delta": " 4*3\\nresul",
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 13,
    "type": "response.function_call_arguments.delta",
}

data: {
    "delta": "t = 4 * ",
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 14,
    "type": "response.function_call_arguments.delta",
}

data: {
    "delta": "3\\nprin",
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 15,
    "type": "response.function_call_arguments.delta",
}

data: {
    "delta": "t(r",
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 16,
    "type": "response.function_call_arguments.delta",
}

data: {
    "delta": "es",
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 17,
    "type": "response.function_call_arguments.delta",
}

data: {
    "delta": "ult)",
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 18,
    "type": "response.function_call_arguments.delta",
}

data: {
    "delta": '"}',
    "item_id": "__fake_id__tool_call__",
    "output_index": 1,
    "sequence_number": 19,
    "type": "response.function_call_arguments.delta",
}

data: {
    "content_index": 0,
    "delta": "",
    "item_id": "__fake_id__text_1__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 20,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "item_id": "__fake_id__response_content_part__",
    "output_index": 0,
    "part": {
        "annotations": [],
        "text": "I'll execute Python code to calculate 4*3 for you.",
        "type": "output_text",
        "logprobs": null,
    },
    "sequence_number": 21,
    "type": "response.content_part.done",
}

data: {
    "item": {
        "arguments": '{"code": "# Calculate 4*3\\nresult = 4 * 3\\nprint(result)"}',
        "call_id": "toolu_bdrk_01LW5hc2yFFgzaebQ43jp6v6",
        "name": "system__ai__python_exec",
        "type": "function_call",
        "id": "__fake_id__tool_call__",
        "status": null,
    },
    "output_index": 1,
    "sequence_number": 22,
    "type": "response.output_item.done",
}

data: {
    "item": {
        "id": "__fake_id__text_1__",
        "content": [
            {
                "annotations": [],
                "text": "I'll execute Python code to calculate 4*3 for you.",
                "type": "output_text",
                "logprobs": null,
            }
        ],
        "role": "assistant",
        "status": "completed",
        "type": "message",
    },
    "output_index": 0,
    "sequence_number": 23,
    "type": "response.output_item.done",
}

data: {
    "response": {
        "id": "__fake_id__response_completed__",
        "created_at": 1761660865.178889,
        "error": null,
        "incomplete_details": null,
        "instructions": null,
        "metadata": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": [
            {
                "id": "__fake_id__text_1__",
                "content": [
                    {
                        "annotations": [],
                        "text": "I'll execute Python code to calculate 4*3 for you.",
                        "type": "output_text",
                        "logprobs": null,
                    }
                ],
                "role": "assistant",
                "status": "completed",
                "type": "message",
            },
            {
                "arguments": '{"code": "# Calculate 4*3\\nresult = 4 * 3\\nprint(result)"}',
                "call_id": "toolu_bdrk_01LW5hc2yFFgzaebQ43jp6v6",
                "name": "system__ai__python_exec",
                "type": "function_call",
                "id": "__fake_id__tool_call__",
                "status": null,
            },
        ],
        "parallel_tool_calls": false,
        "temperature": null,
        "tool_choice": "auto",
        "tools": [],
        "top_p": null,
        "background": null,
        "conversation": null,
        "max_output_tokens": null,
        "max_tool_calls": null,
        "previous_response_id": null,
        "prompt": null,
        "prompt_cache_key": null,
        "reasoning": null,
        "safety_identifier": null,
        "service_tier": null,
        "status": null,
        "text": null,
        "top_logprobs": null,
        "truncation": null,
        "usage": {
            "input_tokens": 505,
            "input_tokens_details": {"cached_tokens": 0},
            "output_tokens": 94,
            "output_tokens_details": {"reasoning_tokens": 0},
            "total_tokens": 599,
        },
        "user": null,
    },
    "sequence_number": 24,
    "type": "response.completed",
}

data: {
    "call_id": "toolu_bdrk_01LW5hc2yFFgzaebQ43jp6v6",
    "output": '{"type":"text","text":"{\\"is_truncated\\":false,\\"columns\\":[\\"output\\"],\\"rows\\":[[\\"12\\n\\"]]}","annotations":null,"meta":null}',
    "type": "function_call_output",
}

data: {
    "response": {
        "id": "__fake_id__response_created__",
        "created_at": 1761660870.595438,
        "error": null,
        "incomplete_details": null,
        "instructions": null,
        "metadata": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": [],
        "parallel_tool_calls": false,
        "temperature": null,
        "tool_choice": "auto",
        "tools": [],
        "top_p": null,
        "background": null,
        "conversation": null,
        "max_output_tokens": null,
        "max_tool_calls": null,
        "previous_response_id": null,
        "prompt": null,
        "prompt_cache_key": null,
        "reasoning": null,
        "safety_identifier": null,
        "service_tier": null,
        "status": null,
        "text": null,
        "top_logprobs": null,
        "truncation": null,
        "usage": null,
        "user": null,
    },
    "sequence_number": 0,
    "type": "response.created",
}

data: {
    "item": {
        "id": "__fake_id__response_item__",
        "content": [],
        "role": "assistant",
        "status": "in_progress",
        "type": "message",
    },
    "output_index": 0,
    "sequence_number": 1,
    "type": "response.output_item.added",
}

data: {
    "content_index": 0,
    "item_id": "__fake_id__response_content_part__",
    "output_index": 0,
    "part": {"annotations": [], "text": "", "type": "output_text", "logprobs": null},
    "sequence_number": 2,
    "type": "response.content_part.added",
}

data: {
    "content_index": 0,
    "delta": "The result",
    "item_id": "__fake_id__text_2__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 3,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "delta": " of 4*3",
    "item_id": "__fake_id__text_2__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 4,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "delta": " in Python is 12",
    "item_id": "__fake_id__text_2__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 5,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "delta": ".",
    "item_id": "__fake_id__text_2__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 6,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "delta": "",
    "item_id": "__fake_id__text_2__",
    "logprobs": [],
    "output_index": 0,
    "sequence_number": 7,
    "type": "response.output_text.delta",
}

data: {
    "content_index": 0,
    "item_id": "__fake_id__response_content_part__",
    "output_index": 0,
    "part": {
        "annotations": [],
        "text": "The result of 4*3 in Python is 12.",
        "type": "output_text",
        "logprobs": null,
    },
    "sequence_number": 8,
    "type": "response.content_part.done",
}

data: {
    "item": {
        "id": "__fake_id__text_2__",
        "content": [
            {
                "annotations": [],
                "text": "The result of 4*3 in Python is 12.",
                "type": "output_text",
                "logprobs": null,
            }
        ],
        "role": "assistant",
        "status": "completed",
        "type": "message",
    },
    "output_index": 0,
    "sequence_number": 9,
    "type": "response.output_item.done",
}

data: {
    "response": {
        "id": "__fake_id__response_competed__",
        "created_at": 1761660870.595438,
        "error": null,
        "incomplete_details": null,
        "instructions": null,
        "metadata": null,
        "model": "databricks-claude-3-7-sonnet",
        "object": "response",
        "output": [
            {
                "id": "__fake_id__text_2__",
                "content": [
                    {
                        "annotations": [],
                        "text": "The result of 4*3 in Python is 12.",
                        "type": "output_text",
                        "logprobs": null,
                    }
                ],
                "role": "assistant",
                "status": "completed",
                "type": "message",
            }
        ],
        "parallel_tool_calls": false,
        "temperature": null,
        "tool_choice": "auto",
        "tools": [],
        "top_p": null,
        "background": null,
        "conversation": null,
        "max_output_tokens": null,
        "max_tool_calls": null,
        "previous_response_id": null,
        "prompt": null,
        "prompt_cache_key": null,
        "reasoning": null,
        "safety_identifier": null,
        "service_tier": null,
        "status": null,
        "text": null,
        "top_logprobs": null,
        "truncation": null,
        "usage": {
            "input_tokens": 650,
            "input_tokens_details": {"cached_tokens": 0},
            "output_tokens": 18,
            "output_tokens_details": {"reasoning_tokens": 0},
            "total_tokens": 668,
        },
        "user": null,
    },
    "sequence_number": 10,
    "type": "response.completed",
}
`,
  out: [
    // First text message: "I'll execute Python code to calculate 4*3 for you."
    { type: 'text-start', id: '__fake_id__text_1__' },
    {
      type: 'text-delta',
      id: '__fake_id__text_1__',
      delta: 'I',
      providerMetadata: { databricks: { itemId: '__fake_id__text_1__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_1__',
      delta: "'ll execute",
      providerMetadata: { databricks: { itemId: '__fake_id__text_1__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_1__',
      delta: ' Python code to calculate',
      providerMetadata: { databricks: { itemId: '__fake_id__text_1__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_1__',
      delta: ' 4*',
      providerMetadata: { databricks: { itemId: '__fake_id__text_1__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_1__',
      delta: '3 for',
      providerMetadata: { databricks: { itemId: '__fake_id__text_1__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_1__',
      delta: ' you.',
      providerMetadata: { databricks: { itemId: '__fake_id__text_1__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_1__',
      delta: '',
      providerMetadata: { databricks: { itemId: '__fake_id__text_1__' } },
    },
    { type: 'text-end', id: '__fake_id__text_1__' },
    {
      type: 'tool-call',
      toolCallId: 'toolu_bdrk_01LW5hc2yFFgzaebQ43jp6v6',
      toolName: 'databricks-tool-call',
      input: '{"code": "# Calculate 4*3\nresult = 4 * 3\nprint(result)"}',
      providerMetadata: {
        databricks: {
          toolName: 'system__ai__python_exec',
          itemId: '__fake_id__tool_call__',
        },
      },
    },
    {
      type: 'tool-result',
      toolCallId: 'toolu_bdrk_01LW5hc2yFFgzaebQ43jp6v6',
      result:
        '{"type":"text","text":"{"is_truncated":false,"columns":["output"],"rows":[["12\n"]]}","annotations":null,"meta":null}',
      toolName: 'databricks-tool-call',
    },
    // Second text message: "The result of 4*3 in Python is 12."
    { type: 'text-start', id: '__fake_id__text_2__' },
    {
      type: 'text-delta',
      id: '__fake_id__text_2__',
      delta: 'The result',
      providerMetadata: { databricks: { itemId: '__fake_id__text_2__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_2__',
      delta: ' of 4*3',
      providerMetadata: { databricks: { itemId: '__fake_id__text_2__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_2__',
      delta: ' in Python is 12',
      providerMetadata: { databricks: { itemId: '__fake_id__text_2__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_2__',
      delta: '.',
      providerMetadata: { databricks: { itemId: '__fake_id__text_2__' } },
    },
    {
      type: 'text-delta',
      id: '__fake_id__text_2__',
      delta: '',
      providerMetadata: { databricks: { itemId: '__fake_id__text_2__' } },
    },
    { type: 'text-end', id: '__fake_id__text_2__' },
  ],
};

type LLMOutputFixtures = {
  in: string;
  out: Array<LanguageModelV3StreamPart>;
};
