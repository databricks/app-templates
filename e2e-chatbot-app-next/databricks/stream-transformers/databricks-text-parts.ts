import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';
import type { DatabricksStreamPartTransformer } from './databricks-stream-part-transformers';

export const applyDatabricksTextPartTransform: DatabricksStreamPartTransformer<
  LanguageModelV2StreamPart
> = (parts, last) => {
  const out: LanguageModelV2StreamPart[] = [];

  for (const incoming of parts) {
    if (isRawAssistantMessagePart(incoming)) {
      if (last?.type === 'text-delta') {
        out.push({ type: 'text-end', id: last.id });
      }
      out.push(
        { type: 'text-start', id: incoming.rawValue.item.id },
        rawAssistantMessagePartToTextPart(incoming),
        { type: 'text-end', id: incoming.rawValue.item.id },
      );
      continue;
    }

    if (
      last?.type === 'text-delta' &&
      incoming.type !== 'text-delta' &&
      incoming.type !== 'text-end'
    ) {
      out.push(incoming);
    } else if (
      // 2️⃣ We have a fresh text‑delta chunk → inject a `text-start`.
      incoming.type === 'text-delta' &&
      (last === null || last.type !== 'text-delta')
    ) {
      out.push({ type: 'text-start', id: incoming.id }, incoming);
    } else if (
      // 3️⃣ A `text-delta` with a **different** id follows another `text-delta` → close the
      incoming.type === 'text-delta' &&
      last?.type === 'text-delta' &&
      last.id !== incoming.id
    ) {
      out.push({ type: 'text-start', id: incoming.id }, incoming);
    } else if (incoming.type === 'text-end' && last?.type !== 'text-delta') {
      // Filter this one out
    } else {
      // Otherwise, pass through the incoming chunk
      out.push(incoming);
    }
  }

  return { out };
};

type RawAssistantMessagePart = {
  type: 'raw';
  rawValue: {
    type: 'response.output_item.done';
    item: {
      id: string;
      content: [
        {
          text: "Based on the sales data from our finance system, **Citrus is the best selling flavor** among our current energy drink lineup.\n\nHere's the sales performance breakdown:\n\n1. **Citrus** - $12.92 million in total net sales (best seller)\n2. **Original** - $12.40 million in total net sales \n3. **Berry** - $11.08 million in total net sales\n4. **Grape** - $5.07 million in total net sales\n\nCitrus leads by a margin of about $520,000 over Original, making it our top performer. Grape significantly trails the other flavors with roughly half the sales volume of the next best performer (Berry).";
          type: 'output_text';
        },
      ];
      role: 'assistant';
      type: 'message';
    };
    id: string;
  };
};
export const isRawAssistantMessagePart = (
  part: LanguageModelV2StreamPart,
): part is RawAssistantMessagePart => {
  if (part.type !== 'raw') return false;
  const rawValue = part.rawValue as any;
  return (
    rawValue?.type === 'response.output_item.done' &&
    rawValue?.item?.type === 'message' &&
    rawValue?.item?.role === 'assistant'
  );
};
const rawAssistantMessagePartToTextPart = (
  part: RawAssistantMessagePart,
): LanguageModelV2StreamPart => {
  return {
    type: 'text-delta',
    id: part.rawValue.item.id,
    delta: part.rawValue.item.content[0].text,
  };
};
