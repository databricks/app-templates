import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';
import type { DatabricksStreamPartTransformer } from './databricks-stream-part-transformers';
import { isToolCallOutputStreamPart } from './databricks-tool-calling';
import { isRawAssistantMessagePart } from './databricks-text-parts';

/**
 * Stream part transformers
 */
export const applyDatabricksRawChunkStreamPartTransform: DatabricksStreamPartTransformer<
  LanguageModelV2StreamPart
> = (parts, last) => {
  const out = parts.flatMap((part): LanguageModelV2StreamPart[] => {
    if (part.type === 'raw') {
      // Filter out all raw chunks expect the ones we want to keep
      if (!isToolCallOutputStreamPart(part) && !isRawAssistantMessagePart(part))
        return [];
    }
    return [part];
  });
  return {
    out,
    last,
  };
};
