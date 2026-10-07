import type { ChatMessage } from '@chat-template/core';

export type ChatPart = ChatMessage['parts'][number];
export type ToolPart = Extract<ChatPart, { type: 'dynamic-tool' }>;

export type RenderBlock =
  | { kind: 'segment'; parts: ChatPart[]; index: number }
  | { kind: 'tool-group'; tools: ToolPart[]; startIndex: number };

export function groupConsecutiveToolSegments(
  partSegments: ChatPart[][],
): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let i = 0;
  while (i < partSegments.length) {
    const segment = partSegments[i];
    const firstPart = segment[0];
    if (firstPart?.type === 'dynamic-tool') {
      const startIndex = i;
      const tools: ToolPart[] = [firstPart as ToolPart];
      i++;
      while (
        i < partSegments.length &&
        partSegments[i][0]?.type === 'dynamic-tool'
      ) {
        tools.push(partSegments[i][0] as ToolPart);
        i++;
      }
      blocks.push({ kind: 'tool-group', tools, startIndex });
    } else {
      blocks.push({ kind: 'segment', parts: segment, index: i });
      i++;
    }
  }
  return blocks;
}
