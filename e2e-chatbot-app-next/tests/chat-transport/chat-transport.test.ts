import { expect, test } from '@playwright/test';
import type { UIMessageChunk } from 'ai';
import {
  ChatTransport,
  type StreamingPartIds,
} from '../../client/src/lib/ChatTransport';

/**
 * Helper to collect all chunks from a readable stream
 */
async function collectStreamChunks(
  stream: ReadableStream<UIMessageChunk>,
): Promise<UIMessageChunk[]> {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

/**
 * Helper to create a mock stream from chunks
 */
function createMockStream(
  chunks: UIMessageChunk[],
): ReadableStream<UIMessageChunk> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Simulates what the AI SDK does when processing stream chunks.
 * Used to verify that merged parts have correct combined content.
 */
interface SimulatedMessagePart {
  type: string;
  id: string;
  content?: string;
  state: 'streaming' | 'complete';
}

function simulateAISDKChunkProcessing(chunks: UIMessageChunk[]): {
  parts: SimulatedMessagePart[];
} {
  const parts: SimulatedMessagePart[] = [];

  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'reasoning-start': {
        parts.push({
          type: 'reasoning',
          id: (chunk as any).id,
          content: '',
          state: 'streaming',
        });
        break;
      }
      case 'reasoning-delta': {
        const part = parts.find(
          (p) => p.type === 'reasoning' && p.id === (chunk as any).id,
        );
        if (part) {
          part.content = (part.content || '') + (chunk as any).delta;
        }
        break;
      }
      case 'reasoning-end': {
        const part = parts.find(
          (p) => p.type === 'reasoning' && p.id === (chunk as any).id,
        );
        if (part) {
          part.state = 'complete';
        }
        break;
      }
      case 'text-start': {
        parts.push({
          type: 'text',
          id: (chunk as any).id,
          content: '',
          state: 'streaming',
        });
        break;
      }
      case 'text-delta': {
        const part = parts.find(
          (p) => p.type === 'text' && p.id === (chunk as any).id,
        );
        if (part) {
          part.content = (part.content || '') + (chunk as any).delta;
        }
        break;
      }
      case 'text-end': {
        const part = parts.find(
          (p) => p.type === 'text' && p.id === (chunk as any).id,
        );
        if (part) {
          part.state = 'complete';
        }
        break;
      }
    }
  }

  return { parts };
}

test.describe('ChatTransport', () => {
  test.describe('prependChunksToStream', () => {
    test('prepends synthetic chunks before original stream', async () => {
      const receivedParts: UIMessageChunk[] = [];
      const streamingPartIds: StreamingPartIds = {
        reasoning: 'reasoning-interrupted',
      };

      const transport = new ChatTransport({
        onStreamPart: (part) => receivedParts.push(part),
        getStreamingPartIds: () => streamingPartIds,
      });

      const prependChunksToStream = (
        transport as any
      ).prependChunksToStream.bind(transport);

      const syntheticChunks: UIMessageChunk[] = [
        {
          type: 'reasoning-start',
          id: 'reasoning-interrupted',
        } as UIMessageChunk,
      ];

      const originalChunks: UIMessageChunk[] = [
        {
          type: 'reasoning-delta',
          id: 'reasoning-interrupted',
          delta: 'continued reasoning',
        } as UIMessageChunk,
        {
          type: 'reasoning-end',
          id: 'reasoning-interrupted',
        } as UIMessageChunk,
        { type: 'text-start', id: 'text-1' } as UIMessageChunk,
        { type: 'text-delta', id: 'text-1', delta: 'Hello' } as UIMessageChunk,
        { type: 'text-end', id: 'text-1' } as UIMessageChunk,
      ];

      const originalStream = createMockStream(originalChunks);
      const prependedStream = prependChunksToStream(
        syntheticChunks,
        originalStream,
      );

      const collectedChunks = await collectStreamChunks(prependedStream);

      // Should have synthetic chunk first, then original chunks
      expect(collectedChunks).toHaveLength(6);
      expect(collectedChunks[0]).toEqual({
        type: 'reasoning-start',
        id: 'reasoning-interrupted',
      });
      expect(collectedChunks[1]).toEqual({
        type: 'reasoning-delta',
        id: 'reasoning-interrupted',
        delta: 'continued reasoning',
      });
    });
  });

  test.describe('stream resume with merge', () => {
    test('merges content from duplicate parts after stream resume', () => {
      // Phase 1: Initial stream (before disconnect)
      const initialChunks: UIMessageChunk[] = [
        { type: 'reasoning-start', id: 'r-1' } as UIMessageChunk,
        {
          type: 'reasoning-delta',
          id: 'r-1',
          delta: 'thinking about ',
        } as UIMessageChunk,
      ];

      const { parts: partsAfterDisconnect } =
        simulateAISDKChunkProcessing(initialChunks);

      // Phase 2: Simulate resume with synthetic start
      const syntheticAndResumedChunks: UIMessageChunk[] = [
        { type: 'reasoning-start', id: 'r-1' } as UIMessageChunk,
        {
          type: 'reasoning-delta',
          id: 'r-1',
          delta: 'the problem',
        } as UIMessageChunk,
        { type: 'reasoning-end', id: 'r-1' } as UIMessageChunk,
        { type: 'text-start', id: 't-1' } as UIMessageChunk,
        {
          type: 'text-delta',
          id: 't-1',
          delta: 'Here is my answer',
        } as UIMessageChunk,
        { type: 'text-end', id: 't-1' } as UIMessageChunk,
      ];

      const { parts: partsFromResume } = simulateAISDKChunkProcessing(
        syntheticAndResumedChunks,
      );

      // Merge duplicate parts by combining content (this is what chat.tsx does)
      const allParts = [...partsAfterDisconnect, ...partsFromResume];
      const mergedParts: SimulatedMessagePart[] = [];
      const seenIds = new Map<string, number>();

      for (const part of allParts) {
        if (seenIds.has(part.id)) {
          const existingIndex = seenIds.get(part.id);
          if (existingIndex === undefined) continue;
          mergedParts[existingIndex].content =
            (mergedParts[existingIndex].content || '') + (part.content || '');
          mergedParts[existingIndex].state = part.state;
        } else {
          seenIds.set(part.id, mergedParts.length);
          mergedParts.push({ ...part });
        }
      }

      // After merging, we have correct content
      expect(mergedParts).toHaveLength(2); // 1 reasoning + 1 text

      const reasoningParts = mergedParts.filter((p) => p.type === 'reasoning');
      expect(reasoningParts).toHaveLength(1);
      expect(reasoningParts[0].content).toBe('thinking about the problem');
      expect(reasoningParts[0].state).toBe('complete');

      const textParts = mergedParts.filter((p) => p.type === 'text');
      expect(textParts).toHaveLength(1);
      expect(textParts[0].content).toBe('Here is my answer');
    });
  });
});
