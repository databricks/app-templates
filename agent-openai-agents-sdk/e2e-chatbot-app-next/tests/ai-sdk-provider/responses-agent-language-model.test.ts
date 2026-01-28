import { expect, test } from '@playwright/test';
import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';
import { DatabricksResponsesAgentLanguageModel } from '../../packages/ai-sdk-providers/src/databricks-provider/responses-agent-language-model/responses-agent-language-model';
import { RESPONSES_AGENT_OUTPUT_WITH_TOOL_CALLS } from '../prompts/llm-output-fixtures';
import {
  MCP_APPROVAL_REQUEST_FIXTURE,
  MCP_APPROVAL_RESPONSE_APPROVED_FIXTURE,
  MCP_APPROVAL_RESPONSE_DENIED_FIXTURE,
} from '../prompts/mcp-approval-fixtures';

/**
 * Removes trailing commas from JSON strings (JavaScript JSON.parse doesn't allow them)
 */
function removeTrailingCommas(jsonStr: string): string {
  // Remove commas before closing braces or brackets (repeat until no more matches)
  let result = jsonStr;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/,(\s*[}\]])/g, '$1');
  } while (result !== prev);
  return result;
}

/**
 * Converts JavaScript object notation (with single quotes) to valid JSON (with double quotes)
 * This handles string values like: "delta": '{"code": "#' -> "delta": "{\"code\": \"#"
 */
function convertToValidJSON(jsStr: string): string {
  // Replace single-quoted string values with double-quoted strings
  // We need to handle cases where the value might contain escaped quotes or other complex content
  let result = jsStr;

  // Pattern: "key": '...' where ... can contain anything except unescaped single quotes
  // We use a more permissive pattern that matches everything between single quotes
  const regex = /"([^"]+)":\s*'((?:[^'\\]|\\.)*)'/g;

  result = result.replace(regex, (_match, key, value) => {
    // The value might already have escaped quotes (\"), keep them but also escape unescaped quotes
    // Since JSON uses double quotes, any literal double quotes in the value need to be escaped
    const escapedValue = value
      .replace(/\\"/g, '###ESCAPED_QUOTE###') // Temporarily protect already-escaped quotes
      .replace(/"/g, '\\"') // Escape unescaped quotes
      .replace(/###ESCAPED_QUOTE###/g, '\\"'); // Restore escaped quotes
    return `"${key}": "${escapedValue}"`;
  });

  return result;
}

/**
 * Creates a mock fetch function that returns the fixture SSE stream
 * Parses SSE content by splitting on "data:" markers
 */
function createMockFetch(sseContent: string): typeof fetch {
  return async () => {
    const encoder = new TextEncoder();

    // Split by "data:" and filter out empty strings
    const rawEvents = sseContent.split(/\ndata:/).filter((s) => s.trim());

    const events: string[] = [];
    for (let rawEvent of rawEvents) {
      // Remove leading "data:" if present (first event might have it)
      rawEvent = rawEvent.replace(/^data:\s*/, '').trim();

      try {
        // Convert JS notation to valid JSON, then remove trailing commas
        let cleanedJson = convertToValidJSON(rawEvent);
        cleanedJson = removeTrailingCommas(cleanedJson);
        const parsed = JSON.parse(cleanedJson);
        events.push(`data: ${JSON.stringify(parsed)}`);
      } catch (e) {
        // If it's not JSON (like "[DONE]"), keep as is
        console.log('Failed to parse JSON:', e, rawEvent.substring(0, 100));
        events.push(`data: ${rawEvent}`);
      }
    }

    const stream = new ReadableStream({
      start(controller) {
        for (const event of events) {
          // SSE format: each event followed by double newline
          controller.enqueue(encoder.encode(`${event}\n\n`));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    });
  };
}

test.describe('DatabricksResponsesAgentLanguageModel', () => {
  test('correctly converts RESPONSES_AGENT_OUTPUT_WITH_TOOL_CALLS fixture', async () => {
    // Create a mock fetch that returns the fixture SSE stream
    const mockFetch = createMockFetch(
      RESPONSES_AGENT_OUTPUT_WITH_TOOL_CALLS.in,
    );

    // Instantiate the model with mock config
    const model = new DatabricksResponsesAgentLanguageModel('test-model', {
      provider: 'databricks',
      headers: () => ({ Authorization: 'Bearer test-token' }),
      url: () => 'http://test.example.com/api',
      fetch: mockFetch,
    });

    // Call doStream
    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      //   mode: { type: 'regular' },
    });

    // Collect all stream parts
    const streamParts: LanguageModelV2StreamPart[] = [];
    const reader = result.stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamParts.push(value);
      }
    } catch (error) {
      console.error('Error reading stream:', error);
      throw error;
    }

    // Filter out stream-start and finish parts for comparison
    const contentParts = streamParts.filter(
      (part) =>
        part.type !== 'stream-start' &&
        part.type !== 'finish' &&
        part.type !== 'raw',
    );

    console.log('contentParts', JSON.stringify(contentParts, null, 2));

    // Verify the number of parts matches expected
    expect(contentParts.length).toBe(
      RESPONSES_AGENT_OUTPUT_WITH_TOOL_CALLS.out.length,
    );

    // Verify each part matches the expected output
    for (let i = 0; i < contentParts.length; i++) {
      const actual = contentParts[i];
      const expected = RESPONSES_AGENT_OUTPUT_WITH_TOOL_CALLS.out[i];

      expect(actual).toMatchObject(expected as any);
    }
  });
});

test.describe('MCP Approval Streaming', () => {
  test('correctly converts MCP approval request stream', async () => {
    const mockFetch = createMockFetch(MCP_APPROVAL_REQUEST_FIXTURE.in);

    const model = new DatabricksResponsesAgentLanguageModel('test-model', {
      provider: 'databricks',
      headers: () => ({ Authorization: 'Bearer test-token' }),
      url: () => 'http://test.example.com/api',
      fetch: mockFetch,
    });

    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
    });

    const streamParts: LanguageModelV2StreamPart[] = [];
    const reader = result.stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamParts.push(value);
    }

    const contentParts = streamParts.filter(
      (part) =>
        part.type !== 'stream-start' &&
        part.type !== 'finish' &&
        part.type !== 'raw',
    );

    // Verify the number of parts
    expect(contentParts.length).toBe(MCP_APPROVAL_REQUEST_FIXTURE.out.length);

    // Verify each part
    for (let i = 0; i < contentParts.length; i++) {
      expect(contentParts[i]).toMatchObject(
        MCP_APPROVAL_REQUEST_FIXTURE.out[i] as any,
      );
    }

    // Verify MCP approval request has correct metadata
    const mcpRequestPart = contentParts.find(
      (part) =>
        part.type === 'tool-call' &&
        (part as any).providerMetadata?.databricks?.type ===
          'mcp_approval_request',
    );
    expect(mcpRequestPart).toBeDefined();
    expect((mcpRequestPart as any).providerMetadata.databricks).toMatchObject({
      type: 'mcp_approval_request',
      toolName: 'test_mcp_tool',
      serverLabel: 'test-server',
    });
  });

  test('correctly converts MCP approval response (approved) stream', async () => {
    const mockFetch = createMockFetch(
      MCP_APPROVAL_RESPONSE_APPROVED_FIXTURE.in,
    );

    const model = new DatabricksResponsesAgentLanguageModel('test-model', {
      provider: 'databricks',
      headers: () => ({ Authorization: 'Bearer test-token' }),
      url: () => 'http://test.example.com/api',
      fetch: mockFetch,
    });

    // The approval response comes in a second API call after the approval request.
    // We need to include the original tool-call from the approval request in the prompt.
    const result = await model.doStream({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'test' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: '__fake_mcp_request_id__',
              toolName: 'databricks-tool-call',
              input: { action: 'test', param: 'value' },
            },
          ],
        },
      ],
    });

    const streamParts: LanguageModelV2StreamPart[] = [];
    const reader = result.stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamParts.push(value);
    }

    const contentParts = streamParts.filter(
      (part) =>
        part.type !== 'stream-start' &&
        part.type !== 'finish' &&
        part.type !== 'raw',
    );

    // Verify the number of parts
    expect(contentParts.length).toBe(
      MCP_APPROVAL_RESPONSE_APPROVED_FIXTURE.out.length,
    );

    // Verify each part
    for (let i = 0; i < contentParts.length; i++) {
      expect(contentParts[i]).toMatchObject(
        MCP_APPROVAL_RESPONSE_APPROVED_FIXTURE.out[i] as any,
      );
    }

    // Verify MCP approval response has correct approval status
    const mcpResponsePart = contentParts.find(
      (part) =>
        part.type === 'tool-result' &&
        (part as any).providerMetadata?.databricks?.type ===
          'mcp_approval_response',
    );
    expect(mcpResponsePart).toBeDefined();
    expect((mcpResponsePart as any).result).toEqual({
      __approvalStatus__: true,
    });
  });

  test('correctly converts MCP approval response (denied) stream', async () => {
    const mockFetch = createMockFetch(MCP_APPROVAL_RESPONSE_DENIED_FIXTURE.in);

    const model = new DatabricksResponsesAgentLanguageModel('test-model', {
      provider: 'databricks',
      headers: () => ({ Authorization: 'Bearer test-token' }),
      url: () => 'http://test.example.com/api',
      fetch: mockFetch,
    });

    // The approval response comes in a second API call after the approval request.
    // We need to include the original tool-call from the approval request in the prompt.
    const result = await model.doStream({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'test' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: '__fake_mcp_request_id__',
              toolName: 'databricks-tool-call',
              input: { action: 'test', param: 'value' },
            },
          ],
        },
      ],
    });

    const streamParts: LanguageModelV2StreamPart[] = [];
    const reader = result.stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamParts.push(value);
    }

    const contentParts = streamParts.filter(
      (part) =>
        part.type !== 'stream-start' &&
        part.type !== 'finish' &&
        part.type !== 'raw',
    );

    // Verify the number of parts
    expect(contentParts.length).toBe(
      MCP_APPROVAL_RESPONSE_DENIED_FIXTURE.out.length,
    );

    // Verify each part
    for (let i = 0; i < contentParts.length; i++) {
      expect(contentParts[i]).toMatchObject(
        MCP_APPROVAL_RESPONSE_DENIED_FIXTURE.out[i] as any,
      );
    }

    // Verify MCP approval response has correct denial status
    const mcpResponsePart = contentParts.find(
      (part) =>
        part.type === 'tool-result' &&
        (part as any).providerMetadata?.databricks?.type ===
          'mcp_approval_response',
    );
    expect(mcpResponsePart).toBeDefined();
    expect((mcpResponsePart as any).result).toEqual({
      __approvalStatus__: false,
    });
  });
});

test.describe('Deduplication Logic', () => {
  test('deduplicates .done event when text matches reconstructed deltas', async () => {
    const sseContent = `
data: {
  "type": "response.output_text.delta",
  "item_id": "msg_123",
  "delta": "Hello "
}

data: {
  "type": "response.output_text.delta",
  "item_id": "msg_123",
  "delta": "World"
}

data: {
  "type": "response.output_item.done",
  "item": {
    "type": "message",
    "id": "msg_123",
    "role": "assistant",
    "content": [{ "type": "text", "text": "Hello World[^ref]" }]
  }
}
    `;

    const mockFetch = createMockFetch(sseContent);
    const model = new DatabricksResponsesAgentLanguageModel('test-model', {
      provider: 'databricks',
      headers: () => ({ Authorization: 'Bearer test-token' }),
      url: () => 'http://test.example.com/api',
      fetch: mockFetch,
    });

    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
    });

    const parts: LanguageModelV2StreamPart[] = [];
    const reader = result.stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    const textParts = parts.filter((p) => p.type === 'text-delta');

    // Expect "Hello " and "World", but NOT "Hello World[^ref]" from .done
    expect(textParts.length).toBe(2);
    expect(textParts[0].delta).toBe('Hello ');
    expect(textParts[1].delta).toBe('World');
  });

  test('does NOT dedupe .done event when text content differs', async () => {
    const sseContent = `
data: {
  "type": "response.output_text.delta",
  "item_id": "msg_123",
  "delta": "Hello "
}

data: {
  "type": "response.output_text.delta",
  "item_id": "msg_123",
  "delta": "World"
}

data: {
  "type": "response.output_item.done",
  "item": {
    "type": "message",
    "id": "msg_123",
    "role": "assistant",
    "content": [{ "type": "text", "text": "Different Text" }]
  }
}
    `;

    const mockFetch = createMockFetch(sseContent);
    const model = new DatabricksResponsesAgentLanguageModel('test-model', {
      provider: 'databricks',
      headers: () => ({ Authorization: 'Bearer test-token' }),
      url: () => 'http://test.example.com/api',
      fetch: mockFetch,
    });

    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
    });

    const parts: LanguageModelV2StreamPart[] = [];
    const reader = result.stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    const textParts = parts.filter((p) => p.type === 'text-delta');
    // "Hello ", "World", and then "Different Text" from .done
    expect(textParts.length).toBe(3);
    expect(textParts[0].delta).toBe('Hello ');
    expect(textParts[1].delta).toBe('World');
    expect(textParts[2].delta).toBe('Different Text');

    // Should NOT be deduped -> .done event emits text-start?
    // Since we removed text-start from .done converter, we only expect the initial text-start from the stream
    const textStartParts = parts.filter((p) => p.type === 'text-start');
    expect(textStartParts.length).toBe(1);
  });
});
