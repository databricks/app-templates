import { expect, test } from '@playwright/test';
import { convertToModelMessages } from 'ai';
import { toModelMessages } from '../../server/src/lib/model-messages';

type UIMessages = Parameters<typeof convertToModelMessages>[0];

function toolPart(state: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'dynamic-tool',
    toolName: 'search',
    toolCallId: 'call-1',
    input: { q: 'x' },
    state,
    ...extra,
  };
}

function history(...assistantParts: unknown[]): UIMessages {
  return [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    { id: 'a1', role: 'assistant', parts: assistantParts },
  ] as unknown as UIMessages;
}

function count(
  messages: Awaited<ReturnType<typeof toModelMessages>>,
  type: string,
) {
  return messages
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((part) => (part as { type: string }).type === type).length;
}

test.describe('toModelMessages (#254)', () => {
  test('drops a tool call that never got a result', async () => {
    const messages = await toModelMessages(
      history(toolPart('input-available')),
    );
    expect(count(messages, 'tool-call')).toBe(0);
    expect(count(messages, 'tool-result')).toBe(0);
  });

  test('sends one call and one result for a duplicated toolCallId', async () => {
    const messages = await toModelMessages(
      history(
        toolPart('input-available'),
        toolPart('output-available', { output: { hits: 1 } }),
      ),
    );
    expect(count(messages, 'tool-call')).toBe(1);
    expect(count(messages, 'tool-result')).toBe(1);
  });

  test('keeps a completed tool call and its result', async () => {
    const messages = await toModelMessages(
      history(toolPart('output-available', { output: { hits: 1 } })),
    );
    expect(count(messages, 'tool-call')).toBe(1);
    expect(count(messages, 'tool-result')).toBe(1);
  });

  test('leaves responded and denied approvals as they were', async () => {
    for (const part of [
      toolPart('approval-responded', {
        approval: { id: 'ap-1', approved: true },
      }),
      toolPart('output-denied', { approval: { id: 'ap-1', approved: false } }),
    ]) {
      const withOption = await toModelMessages(history(part));
      const without = await convertToModelMessages(history(part));
      expect(withOption).toEqual(without);
    }
  });
});
