import { expect, test } from '@playwright/test';
import { groupConsecutiveToolSegments } from '../../client/src/lib/tool-group-segments';
import type { ChatPart } from '../../client/src/lib/tool-group-segments';

function toolPart(toolCallId: string): ChatPart {
  return {
    type: 'dynamic-tool',
    toolCallId,
    toolName: 'test_tool',
    input: {},
    state: 'output-available',
  } as ChatPart;
}

function textPart(text: string): ChatPart {
  return { type: 'text', text } as ChatPart;
}

test.describe('groupConsecutiveToolSegments', () => {
  test('empty input returns empty array', () => {
    expect(groupConsecutiveToolSegments([])).toEqual([]);
  });

  test('single text segment returns a segment block', () => {
    const part = textPart('hello');
    const result = groupConsecutiveToolSegments([[part]]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'segment', parts: [part], index: 0 });
  });

  test('single tool segment returns a tool-group block with one tool', () => {
    const part = toolPart('t1');
    const result = groupConsecutiveToolSegments([[part]]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'tool-group', tools: [part], startIndex: 0 });
  });

  test('consecutive tool segments are collapsed into one tool-group', () => {
    const t1 = toolPart('t1');
    const t2 = toolPart('t2');
    const t3 = toolPart('t3');
    const result = groupConsecutiveToolSegments([[t1], [t2], [t3]]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'tool-group',
      tools: [t1, t2, t3],
      startIndex: 0,
    });
  });

  test('text between tools creates separate blocks', () => {
    const t1 = toolPart('t1');
    const t2 = toolPart('t2');
    const text = textPart('middle');
    const result = groupConsecutiveToolSegments([[t1], [text], [t2]]);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ kind: 'tool-group', tools: [t1] });
    expect(result[1]).toMatchObject({ kind: 'segment', parts: [text] });
    expect(result[2]).toMatchObject({ kind: 'tool-group', tools: [t2] });
  });

  test('tools at the end are grouped separately from leading text', () => {
    const text = textPart('intro');
    const t1 = toolPart('t1');
    const t2 = toolPart('t2');
    const result = groupConsecutiveToolSegments([[text], [t1], [t2]]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: 'segment', parts: [text], index: 0 });
    expect(result[1]).toMatchObject({ kind: 'tool-group', tools: [t1, t2], startIndex: 1 });
  });

  test('tools at the start are grouped separately from trailing text', () => {
    const t1 = toolPart('t1');
    const t2 = toolPart('t2');
    const text = textPart('response');
    const result = groupConsecutiveToolSegments([[t1], [t2], [text]]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: 'tool-group', tools: [t1, t2], startIndex: 0 });
    expect(result[1]).toMatchObject({ kind: 'segment', parts: [text], index: 2 });
  });

  test('multiple separate tool groups are each collapsed independently', () => {
    const t1 = toolPart('t1');
    const t2 = toolPart('t2');
    const t3 = toolPart('t3');
    const t4 = toolPart('t4');
    const text = textPart('between');
    const result = groupConsecutiveToolSegments([[t1], [t2], [text], [t3], [t4]]);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ kind: 'tool-group', tools: [t1, t2], startIndex: 0 });
    expect(result[1]).toMatchObject({ kind: 'segment' });
    expect(result[2]).toMatchObject({ kind: 'tool-group', tools: [t3, t4], startIndex: 3 });
  });

  test('startIndex reflects position in original partSegments array', () => {
    const text = textPart('before');
    const t1 = toolPart('t1');
    const result = groupConsecutiveToolSegments([[text], [t1]]);
    const toolGroup = result[1];
    expect(toolGroup).toMatchObject({ kind: 'tool-group', startIndex: 1 });
  });
});
