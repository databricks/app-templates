import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';

import { composeDatabricksStreamPartTransformers } from './compose-stream-part-transformers';
import { applyDeltaBoundaryTransform } from './databricks-delta-boundary';

/**
 * Allows stream transformations to be composed together.
 *
 * Currently only used to automatically inject start/end
 * deltas since the APIs does not supply the necessary events.
 */
export const getDatabricksLanguageModelTransformStream = () => {
  let lastChunk = null as LanguageModelV2StreamPart | null;
  const deltaEndByTypeAndId = new Set<string>();
  const transformerStreamParts = composeDatabricksStreamPartTransformers(
    applyDeltaBoundaryTransform,
  );
  return new TransformStream<
    LanguageModelV2StreamPart,
    LanguageModelV2StreamPart
  >({
    transform(chunk, controller) {
      // Apply transformation functions to the incoming chunks
      const { out } = transformerStreamParts([chunk], lastChunk);

      // Enqueue the transformed chunks with deduplication
      out.forEach((transformedChunk) => {
        const group = getDeltaGroup(transformedChunk.type);
        const endKey = makeEndKey(getPartId(transformedChunk), group);
        if (endKey && deltaEndByTypeAndId.has(endKey)) {
          // If we already ended this specific group (text/reasoning) for this id, skip further parts of the same group
          return;
        }
        if (
          transformedChunk.type === 'text-end' ||
          transformedChunk.type === 'reasoning-end'
        ) {
          /**
           * We register when a delta ends.
           * We rely on response.output_item.done chunks to display non streamed data
           * so we need to deduplicate them with their corresponding delta chunks.
           */
          const endGroup = getDeltaGroup(transformedChunk.type);
          const key = makeEndKey(getPartId(transformedChunk), endGroup);
          if (key) deltaEndByTypeAndId.add(key);
        }
        controller.enqueue(transformedChunk);
      });

      // Update the last chunk
      lastChunk = out[out.length - 1] ?? lastChunk;
    },
    flush(controller) {
      // Finally, if there's a dangling text-delta, close it
      if (lastChunk?.type === 'text-delta') {
        controller.enqueue({ type: 'text-end', id: lastChunk.id });
      }
      if (lastChunk?.type === 'reasoning-delta') {
        controller.enqueue({ type: 'reasoning-end', id: lastChunk.id });
      }
    },
  });
};

// Utility functions
const getDeltaGroup = (
  type: LanguageModelV2StreamPart['type'],
): 'text' | 'reasoning' | null => {
  if (type.startsWith('text-')) return 'text';
  if (type.startsWith('reasoning-')) return 'reasoning';
  return null;
};
const getPartId = (part: LanguageModelV2StreamPart): string | undefined => {
  return (part as any)?.id as string | undefined;
};
const makeEndKey = (
  id: string | undefined,
  group: ReturnType<typeof getDeltaGroup>,
) => (id && group ? `${group}:${id}` : null);
