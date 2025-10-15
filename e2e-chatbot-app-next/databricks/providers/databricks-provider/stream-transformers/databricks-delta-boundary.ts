import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';
import type { DatabricksStreamPartTransformer } from './compose-stream-part-transformers';

type DeltaType = 'text' | 'reasoning';

/**
 * Injects start/end deltas for sequential streams.
 */
export const applyDeltaBoundaryTransform: DatabricksStreamPartTransformer<
  LanguageModelV2StreamPart
> = (parts, last) => {
  const out: LanguageModelV2StreamPart[] = [];

  const lastDeltaType = maybeGetDeltaType(last);
  for (const incoming of parts) {
    const incomingDeltaType = maybeGetDeltaType(incoming);
    const incomingId = (incoming as any)?.id as string | undefined;
    const lastId = (last as any)?.id as string | undefined;

    // When continuous deltas are detected, we don't need to inject start/end deltas
    const incomingMatchesLast =
      // Only treat as a continuation when both are actual *-delta parts
      Boolean(isDeltaPart(last) && isDeltaPart(incoming)) &&
      Boolean(lastDeltaType && incomingDeltaType) &&
      Boolean(lastDeltaType === incomingDeltaType) && // Same delta group (text/reasoning)
      Boolean(incomingId && lastId && incomingId === lastId); // Same id

    if (incomingMatchesLast) {
      out.push(incoming);
      continue;
    }

    // If there's no delta continuation, and the last part is a delta, we need to end it
    if (isDeltaPart(last)) {
      out.push({ type: `${getDeltaType(last)}-end`, id: last.id });
    }

    // If there's a new delta, we need to start it
    if (isDeltaPart(incoming)) {
      out.push(
        { type: `${getDeltaType(incoming)}-start`, id: incoming.id },
        incoming,
      );
      continue;
    }

    // Otherwise, just push the incoming part
    out.push(incoming);
    continue;
  }

  return { out };
};

type DeltaPart = Extract<
  LanguageModelV2StreamPart,
  { type: `${DeltaType}-${string}` }
>;
const isDeltaIsh = (
  part?: LanguageModelV2StreamPart | null,
): part is DeltaPart =>
  part?.type.startsWith('text-') ||
  part?.type.startsWith('reasoning-') ||
  false;

const maybeGetDeltaType = (part: LanguageModelV2StreamPart | null) => {
  if (!isDeltaIsh(part)) return null;
  if (part.type.startsWith('text-')) return 'text';
  if (part.type.startsWith('reasoning-')) return 'reasoning';
  return null;
};

const getDeltaType = (part: DeltaPart) => {
  if (part.type.startsWith('text-')) return 'text';
  if (part.type.startsWith('reasoning-')) return 'reasoning';
  throw new Error(`Unknown delta type: ${part.type}`);
};

const isDeltaPart = (
  part: LanguageModelV2StreamPart | null,
): part is Extract<LanguageModelV2StreamPart, { type: `${DeltaType}-delta` }> =>
  part?.type === 'text-delta' || part?.type === 'reasoning-delta';
