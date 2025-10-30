import { expect, test } from '@playwright/test';
import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';
import { DatabricksResponsesAgentLanguageModel } from '../../packages/ai-sdk-providers/src/databricks-provider/responses-agent-language-model/responses-agent-language-model';
import { RESPONSES_AGENT_OUTPUT_WITH_TOOL_CALLS } from '../prompts/llm-output-fixtures';

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
